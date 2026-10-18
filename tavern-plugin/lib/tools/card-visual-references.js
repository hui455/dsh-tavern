import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeResourcePath } from '../domain/file-resources.js'
import { sessionEvents } from '../domain/session-events.js'
import { visualReferenceDocument, referenceSummary, updateVisualReferences, sessionReferenceImages, decodeReferenceImage } from '../domain/card-visual-references.js'

export function registerCardVisualReferenceTool({ tools, chatForSession, readCardWorkspace, turnOrchestrator, activeTurnOf, attachments, generateReference }) {
  tools.register(defineTool({
    name: 'tavern_character_reference',
    description: '卡片工作台的人物参考资料工具。list 列出现有参考和本对话可用图片编号；read 读取指定人物的外貌文字及参考图，图片会返回给模型查看。用户要求保存时用 upsert 添加/修改参考文字、英文标签或 imageId 指定的本会话图片；资料随人物卡保存和导出。没有参考不影响默认生图。用户要求根据参考修改人物描述时，先 read 查看，再用 update_description 提交新的完整 description 与原 expectedDescription；也可在 upsert 同时提交这两个字段，原子保存参考和描述。不要臆造图片编号，不自动修改世界书或 MVU。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'read', 'generate', 'upsert', 'remove', 'update_description'] },
      prompt: { type: 'string', description: 'generate 必填：完整人物参考图描述。须同时提供 text 稳定外貌文字；生成成功后自动保存图片、文字和提示词。仅用户要求生图时调用，一次一人；保存失败只重试保存。' },
      generationPrompt: { type: 'string', description: '保存已有生成图片时保留的完整生图提示词，generate 自动填写' },
      path: { type: 'string', description: '人物卡路径，省略为当前卡' },
      name: { type: 'string', description: '卡内人物名称，应与剧情中姓名一致' },
      text: { type: 'string', description: '稳定外貌参考文字；不是本轮动作' },
      tags: { type: 'string', description: '可选的等义英文外貌标签' },
      imageId: { type: 'string', description: 'list 返回的本对话图片 attachmentId' },
      clearImage: { type: 'boolean' },
      expectedRevision: { type: 'integer', description: 'upsert/remove 必填，使用 list/read 返回的 revision' },
      description: { type: 'string', description: '用户要求反向修改人物卡时提交完整新描述，保留未要求修改的设定' },
      expectedDescription: { type: 'string', description: '修改前的完整 description，防止覆盖刚发生的编辑' }
    },
    output: { schema: { type: 'string' }, render(_args, text) {
      const result = JSON.parse(text), images = result.images || []
      delete result.images
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...images.map(attachment => ({ type: 'image', attachment }))]
    } },
    async execute(args, exec) {
      const sessionId = exec.agent.session.id, chat = await chatForSession(sessionId)
      if (!chat || chat.mode !== 'card') throw new Error('人物参考工具仅可在卡片工作台使用')
      const path = normalizeResourcePath(args.path || chat.cardPath || '', 'card')
      const workspace = await readCardWorkspace(path)
      if (!workspace) throw new Error('请先创建或选择人物卡')
      const document = visualReferenceDocument(workspace)
      const available = sessionReferenceImages(sessionEvents(exec.agent.session))
      if (args.action === 'generate') {
        if (!generateReference) throw new Error('当前未启用人物参考生图服务')
        if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 4000) throw new Error('生成参考图时须同时提供稳定外貌文字 text（最多 4000 字符）')
        updateVisualReferences(workspace, { ...args, action: 'upsert', expectedRevision: document.revision })
        const result = await generateReference({ name: args.name, prompt: args.prompt, signal: exec.signal })
        let saved = false, saveError, revision
        try {
          const image = await attachments().readImage(result.attachment)
          const latest = await readCardWorkspace(path)
          const next = updateVisualReferences(latest, { action: 'upsert', name: args.name, text: args.text, tags: args.tags,
            generationPrompt: args.prompt, expectedRevision: document.revision }, image)
          const write = await turnOrchestrator.saveChanges({ sessionId, turn: activeTurnOf(exec), path, fields: {}, rawOperations: [next.operation] })
          saved = write.saved; revision = next.document.revision
        } catch (error) { saveError = error.message }
        return JSON.stringify({ generated: true, saved, saveError, revision, name: args.name, imageId: result.attachment.attachmentId, generationPrompt: args.prompt,
          provider: result.provider, model: result.model, images: [result.attachment],
          instruction: saved ? '参考图、外貌文字和生图提示词已一并保存。' : '图片已生成但保存失败。调用 list 获取最新 revision，再用 upsert 保存这个 imageId、text 和 generationPrompt；只重试保存，不要重新生图。' })
      }
      if (args.action === 'list' || args.action === 'read') {
        const result = { path, ...referenceSummary(document), availableImages: available.map(({ attachmentId, name, mediaType }) => ({ attachmentId, name, mediaType })) }
        if (args.action === 'read') {
          const person = document.characters.find(p => p.name === args.name)
          if (!person) throw new Error('该人物尚无参考资料')
          result.characters = result.characters.filter(p => p.name === args.name)
          if (person.image) result.images = [await attachments().saveImage({ ...decodeReferenceImage(person.image), name: person.name + '-reference' })]
        }
        return JSON.stringify(result)
      }
      if (!['upsert', 'remove', 'update_description'].includes(args.action)) throw new Error('未知人物参考操作')
      const raw = workspace.raw || workspace, data = raw.data || raw
      const fields = {}
      if (args.description !== undefined || args.action === 'update_description') {
        if (typeof args.description !== 'string' || !args.description.trim() || args.description.length > 200000) throw new Error('请提供完整有效的新人物描述')
        if (typeof args.expectedDescription !== 'string' || args.expectedDescription !== (data.description || '')) throw new Error('人物描述已变化，请先读取最新描述再修改')
        if (args.action === 'update_description' && !document.characters.some(p => p.name === args.name)) throw new Error('请先为该人物保存参考资料')
        fields.description = args.description
      }
      let next
      if (args.action !== 'update_description') {
        let image
        if (args.imageId) {
          const ref = available.find(item => item.attachmentId === args.imageId)
          if (!ref) throw new Error('只能使用本次卡片对话已提供的图片，请先上传参考图并调用 list')
          image = await attachments().readImage(ref)
        }
        next = updateVisualReferences(workspace, args, image)
      }
      const result = await turnOrchestrator.saveChanges({ sessionId, turn: activeTurnOf(exec), path, fields, rawOperations: next ? [next.operation] : [] })
      return JSON.stringify({ saved: result.saved, path, changedFields: result.changedFields, ...referenceSummary(next?.document || document) })
    }
  }))
}
