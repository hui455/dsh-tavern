import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerWorkbenchImageTool({ tools, chatForSession, generateImage }) {
  tools.register(defineTool({
    name: 'tavern_generate_image',
    description: '在任意卡片工作台按完整画面描述生成一张图片，支持风景、物品和人物，不需要人物卡、姓名或外貌档案。仅用户明确要求生图时调用；复用当前生图配置，图片保存在本对话，不自动绑定人物或修改卡片。需要保存为人物参考时，可将返回的 imageId 交给 tavern_character_reference 的 list/upsert。失败后报告实际错误，不自动重复请求。此工具是文生图，不能声称编辑了输入图片。',
    parameters: {
      prompt: { type: 'string', required: true, description: '完整画面描述，包含主体、环境和构图，最多 12000 字符。不要自行添加日系、写实、水彩等画风词；画风由用户的全局画风偏好控制' },
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
      const result = await generateImage({ prompt: args.prompt, aspectRatio: args.aspectRatio, signal: exec.signal })
      return JSON.stringify({ generated: true, imageId: result.attachment.attachmentId, generationPrompt: args.prompt,
        provider: result.provider, model: result.model, images: [result.attachment],
        instruction: '图片已生成并保存在本对话。未修改人物卡；仅在用户要求时另行保存为人物参考。' })
    }
  }))
}
