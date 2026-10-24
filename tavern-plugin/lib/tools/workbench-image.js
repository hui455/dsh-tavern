import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionEvents } from '../domain/session-events.js'
import { sessionReferenceImages, encodeReferenceImage, decodeReferenceImage } from '../domain/card-visual-references.js'

export function registerWorkbenchImageTool({ tools, chatForSession, generateImage, attachments }) {
  tools.register(defineTool({
    name: 'tavern_generate_image',
    description: '在任意卡片工作台生成或编辑一张图片，不需要人物卡。仅用户明确要求生图或编辑图片时调用，复用当前生图配置。编辑时必须传 sourceImageId，使用本对话用户指定的原图和 OpenAI 图片编辑接口；不传则是文生图，不能声称编辑了原图。不得臆造图片编号。图片保存在本对话，不自动绑定人物或修改卡片。需要保存为人物参考时可将返回的 imageId 交给 tavern_character_reference。失败后报告实际错误，不自动重复请求。',
    parameters: {
      prompt: { type: 'string', required: true, description: '完整画面描述，包含主体、环境和构图，最多 12000 字符。不要自行添加日系、写实、水彩等画风词；画风由用户的全局画风偏好控制' },
      sourceImageId: { type: 'string', description: '编辑时必填：用户指定的本对话图片 attachmentId（上传图片或此前生图返回的 imageId）。原图将发给当前 OpenAI 生图渠道；不填则仅文生图' },
      aspectRatio: { type: 'string', enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'], description: '按画面选择比例，默认 1:1；用户固定的服务比例优先' }
    },
    output: { schema: { type: 'string' }, render(_args, text) {
      const { images = [], ...result } = JSON.parse(text)
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...images.map(attachment => ({ type: 'image', attachment }))]
    } },
    async execute(args, exec) {
      const chat = await chatForSession(exec.agent.session.id)
      if (!chat || chat.mode !== 'card') throw new Error('自由生图仅可在卡片工作台使用')
      if (!generateImage) throw new Error('当前未启用生图服务')
      let sourceImages
      if (args.sourceImageId !== undefined) {
        if (typeof args.sourceImageId !== 'string' || !args.sourceImageId.trim()) throw new Error('请指定本对话的原图编号')
        const ref = sessionReferenceImages(sessionEvents(exec.agent.session)).find(image => image.attachmentId === args.sourceImageId)
        if (!ref) throw new Error('原图不属于本对话或已不可用，未请求生图')
        sourceImages = [decodeReferenceImage(encodeReferenceImage(await attachments().readImage(ref)))]
      }
      const result = await generateImage({ prompt: args.prompt, aspectRatio: args.aspectRatio, sourceImages, chatId: chat.id, sessionId: exec.agent.session.id, signal: exec.signal })
      return JSON.stringify({ generated: true, edited: Boolean(sourceImages), imageId: result.attachment.attachmentId, generationPrompt: args.prompt,
        provider: result.provider, model: result.model, images: [result.attachment],
        instruction: '图片已生成并保存在本对话。未修改人物卡；仅在用户要求时另行保存为人物参考。' })
    }
  }))
}
