import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { readPlayChatDebugTurn } from '../domain/play-chat-debug.js'
import { redactSceneDiagnostic } from '../domain/scene-image-diagnostics.js'

// A facade over the production image service. Never build a second prompt pipeline.
export function registerPlayImageDebugTool({ tools, chatForSession, readChat, illustrations, diagnostics, store }) {
  tools.register(defineTool({
    name: 'tavern_test_play_image',
    description: '在卡片工作台检查关联游玩的真实生图链路。status/logs/image 只读；start 真实生图并保留在原游玩的图片版本中，会计费，必须用户明确要求测试后使用。每个工作台最多提交 5 个不同请求；失败不自动重试。先读 status，再用其 key 启动；同一次调用重试必须沿用 requestId。image 返回图片供视觉检查；接口成功不等于画面稳定。cancel 仅能取消本工作台发起的请求。',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'start', 'logs', 'image', 'cancel'] },
      ref: { type: 'string', description: '已挂载的 play-chat:对话ID 或对话ID；只有一条关联时可省略' },
      turn: { type: 'integer', description: '目标轮次，默认最新一轮' },
      requestId: { type: 'string', description: 'start/cancel 必填：8–100 位字母、数字、下划线或短横线；logs/image 可用来筛选' },
      key: { type: 'string', description: 'start 必填，从 status 返回的 key 复制，防止正文变化后误画' },
      kind: { type: 'string', enum: ['generate', 'replan', 'repaint'], description: '首次生成、重新规划或同方案重画；默认 generate' },
      versionId: { type: 'string', description: '同方案重画或读取结果图片时指定已有版本' },
      offset: { type: 'integer', description: '日志分页，1 起始字符位置' },
      limit: { type: 'integer', description: '日志最多返回字符数，默认 6000，最大 12000' }
    },
    output: { schema: { type: 'string' }, render(_args, text) {
      const { images = [], ...result } = JSON.parse(text)
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...images.map(attachment => ({ type: 'image', attachment }))]
    } },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!['status', 'start', 'logs', 'image', 'cancel'].includes(args.action)) throw new Error('未知生图诊断操作')
      const editor = await chatForSession(exec?.agent?.session?.id)
      if (editor?.mode !== 'card') throw new Error('仅卡片工作台可使用游玩生图诊断')
      const refs = (editor.workspace?.mountedResources || []).filter(item => item.kind === 'play-chat')
      const ref = args.ref ? refs.find(item => item.path === args.ref || item.chatId === args.ref) : refs.length === 1 ? refs[0] : undefined
      if (!ref) throw new Error('请指定已关联的游玩记录；从游玩进入卡片调试后再试')
      const chat = await readChat(ref.chatId)
      const { turn } = readPlayChatDebugTurn(editor, chat, ref, { turn: args.turn })
      const identity = { chatId: chat.id, sessionId: chat.sessionId, editorChatId: editor.id, turn }
      const reply = value => JSON.stringify(redactSceneDiagnostic({ ...identity, ...value }))
      const path = 'diagnostics/image-tests-' + createHash('sha256').update(editor.id).digest('hex') + '.json'
      if (args.action === 'logs' || args.action === 'image') {
        if (!diagnostics) throw new Error('当前版本未启用生图日志')
        const journal = await diagnostics.read(chat.id)
        const records = journal.records.filter(item => item.turn === turn && (!args.requestId || item.requestId === args.requestId))
        if (args.action === 'image') {
          const record = records.findLast(item => item.details?.attachment && (!args.versionId || item.details.versionId === args.versionId))
          if (!record) throw new Error('没有匹配的已保存图片记录；日志可能已被容量清理')
          return reply({ requestId: record.requestId, versionId: record.details.versionId, images: [record.details.attachment] })
        }
        const text = JSON.stringify(redactSceneDiagnostic({ dropped: journal.dropped, records }), null, 2)
        const offset = Number.isInteger(args.offset) && args.offset > 0 ? args.offset - 1 : 0
        const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(args.limit, 12000)) : 6000
        const start = Math.min(offset, text.length)
        return reply({ text: text.slice(start, start + limit), totalChars: text.length, from: start + 1, done: start + limit >= text.length })
      }
      if (!illustrations) throw new Error('当前版本未启用游玩生图')
      if (args.action === 'status') return reply({ illustration: await illustrations.status(chat.sessionId, turn), budget: await store.readJson(path) || { attempts: [] }, maxRequests: 5 })
      if (typeof args.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(args.requestId)) throw new Error('需要有效的 requestId')
      if (args.action === 'cancel') {
        const attempt = (await store.readJson(path))?.attempts?.find(item => item.requestId === args.requestId && item.chatId === chat.id && item.turn === turn)
        if (!attempt) throw new Error('只能取消本工作台发起的生图请求')
        return reply({ illustration: await illustrations.cancel(chat.sessionId, turn, attempt.key, args.requestId) })
      }
      const kind = args.kind || 'generate'
      if (!['generate', 'replan', 'repaint'].includes(kind)) throw new Error('不支持的测试生图方式')
      const current = await illustrations.status(chat.sessionId, turn)
      if (!args.key || args.key !== current.key) throw new Error('正文版本已变化，请先读取 status 并使用返回的 key')
      if (current.status === 'running' || kind === 'generate' && current.status === 'succeeded') return reply({ illustration: current, submitted: false, note: '已有进行中的请求或已完成图片，未提交新请求。' })
      const attempt = { requestId: args.requestId, chatId: chat.id, turn, key: args.key, kind, versionId: args.versionId || '' }
      // Durable reservation before starting: interrupted/unconfirmed requests consume
      // their slot and cannot silently turn into new paid requests after restart.
      let reserved = false
      await store.updateJson(path, previous => {
        const attempts = previous?.attempts || []
        const old = attempts.find(item => item.requestId === args.requestId)
        if (old && JSON.stringify(old) !== JSON.stringify(attempt)) throw new Error('requestId 已用于其他参数，请查询原请求')
        if (!old && attempts.length >= 5) throw new Error('本工作台已达到 5 次测试提交上限，请汇总证据后停止测试')
        reserved = !old
        return { attempts: old ? attempts : [...attempts, attempt] }
      })
      if (reserved) await diagnostics?.record(chat.id, { requestId: args.requestId, targetKey: args.key, turn, sessionId: chat.sessionId,
        editorChatId: editor.id, origin: 'card-agent-test', status: 'running', stage: 'requested' })
      let illustration
      try { illustration = await illustrations.start(chat.sessionId, turn, args.key, { requestId: args.requestId, kind, versionId: args.versionId }) }
      catch (error) {
        await diagnostics?.record(chat.id, { requestId: args.requestId, targetKey: args.key, turn, sessionId: chat.sessionId,
          editorChatId: editor.id, origin: 'card-agent-test', status: 'failed', stage: 'start', error: String(error.message || error) }).catch(() => {})
        throw error
      }
      return reply({ requestId: args.requestId, illustration, note: '结果保留在关联游玩的图片版本中；用 logs 和 image 检查，失败不得自动换 requestId 重试。' })
    }
  }))
}
