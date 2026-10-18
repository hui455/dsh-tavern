import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { activeStoryTurn } from './story-tool-submission.js'
import { SCENE_CHARACTER_TOOL, SCENE_LAYOUT_TOOL, updateSceneDraft, assembleSceneDraft } from './scene-plan-draft.js'

export const FOREGROUND_SCENE_TOOL = 'tavern_submit_scene_images'
const digest = text => createHash('sha256').update(String(text)).digest('hex')
export const foregroundScenesEnabled = settings => settings?.enabled === true && settings.promptSource === 'main'

export function foregroundSceneInstructions(settings) {
  if (!foregroundScenesEnabled(settings)) return ''
  return `本轮开启主对话同步配图规划。写正文时同时规划 1–6 张必要的场景图，在输出最终正文或调用 submit_story 之前调用 tavern_submit_scene_images 保存方案。最终正文只写剧情，不展示 JSON、绘图标签或工具说明。工具不生图，不要声称图片已生成。每个场景用 characters 提交人物 id/name/fields（appearance/clothing/action/expression/position 的 text 与英文 tags），layout 提交 description、subjects、continuity、scene（composition/environment 的 text 与英文 tags）、anchor（即将输出正文中的原句）、viewpoint、aspectRatio。不同场景不要重复 anchor；layout.additionalScenes 留空，由 scenes 数组表示所有图片。单角色默认 first-person，必要或多角色/阵营/世界控制时用 omniscient；比例按构图选，默认 3:4。人物外貌遵循已有卡片参考，画风保持连续。内部成人内容开关为 ${settings.nsfw === true ? '开启' : '关闭，选择非露骨画面'}；不把 NSFW 字样写入提示词。工具提交失败或无法调用时仍正常完成正文，宿主会用独立助手补齐。`
}

export function createForegroundSceneTool({ chatForSession, settings, isBackground = () => false }) {
  return {
    name: FOREGROUND_SCENE_TOOL,
    description: '游玩主对话提交本轮配图方案，不生成图片、不修改正文。最终正文前提交，人物字段同时包含事实文字和英文绘图标签；每个 layout.anchor 必须出现在随后输出的正文中。',
    parameters: { type: 'object', required: ['scenes'], additionalProperties: false, properties: { scenes: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', required: ['characters', 'layout'], additionalProperties: false,
      properties: { characters: { type: 'array', maxItems: 8, items: SCENE_CHARACTER_TOOL.parameters }, layout: SCENE_LAYOUT_TOOL.parameters } } } } },
    output: { schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: `已暂存 ${JSON.parse(value).plans.length} 个配图方案。请完成正文；图片尚未生成。` }] },
      presentationMeta(_args, value) { return { kind: FOREGROUND_SCENE_TOOL, ...JSON.parse(value) } } },
    async execute(args, exec) {
      const session = exec.agent.session, turn = activeStoryTurn(session)
      const chat = await chatForSession(session.id)
      if (isBackground(session.id) || !['story', 'script'].includes(chat?.mode || 'story') || !foregroundScenesEnabled(await settings())) throw new Error('当前未开启游玩主对话同步配图')
      const operation = Object.values(chat.timeline?.operations || {}).find(item => item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn)
      if (!turn || !operation) throw new Error('当前没有正在生成的游玩回合')
      if (!Array.isArray(args.scenes) || !args.scenes.length || args.scenes.length > 6 || JSON.stringify(args).length > 200000) throw new Error('须提交 1–6 个场景且总长度不超过 200000 字符')
      const plans = args.scenes.map(scene => {
        if (!Array.isArray(scene.characters) || scene.characters.length > 8) throw new Error('每个场景最多 8 个人物')
        let draft
        for (const person of scene.characters) draft = updateSceneDraft(draft, 'submit_scene_character', person)
        draft = updateSceneDraft(draft, 'submit_scene_layout', scene.layout)
        return { ...assembleSceneDraft(draft), additionalScenes: [] }
      })
      return JSON.stringify({ turn, operationId: operation.id, plans })
    }
  }
}

export function foregroundScenePlanForTurn(session, { turn, operationId, sourceText }) {
  for (const event of [...sessionEvents(session)].reverse()) {
    if (event.type !== 'tool/result' || Number(event.data?.turn) !== turn) continue
    const meta = event.data.meta
    if (meta?.kind !== FOREGROUND_SCENE_TOOL || meta.operationId !== operationId || meta.turn !== turn || !Array.isArray(meta.plans)) continue
    if (event.data.message?.content?.some(block => block.isError)) continue
    return { version: 1, sourceDigest: digest(sourceText), plans: structuredClone(meta.plans) }
  }
  return undefined
}

export function matchingForegroundPlans(target) {
  const record = target.foregroundScenePlan
  return record?.version === 1 && record.sourceDigest === digest(target.source) && Array.isArray(record.plans) && record.plans.length <= 6 ? record.plans : null
}
