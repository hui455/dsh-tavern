import { decodeReferenceImage } from './card-visual-references.js'

export const REFERENCE_SCENE_POLICY = `自动配图规则（覆盖通用配图规则）：只画 referenceOnly.people 中有可用参考图、且在目标正文 target 中实际出场的人物。历史、设定、回忆、转述、只被提及或未来计划不算出场；可依据明确上下文识别代词，但不能猜测同名人物。
每张图只画一个符合条件的人物，subjects 必须恰好一个；其他人物不入镜。先识别所有符合条件的人物及其不同场景，主图和 additionalScenes 一起覆盖这些人物与场景。同一人物的不同场景可以多张；不要因字数、段数或连续动作词凑图，不画环境空镜。每项补图必须指定 personName（候选中的准确姓名）、anchor、description、viewpoint。不同人物可以共用同一句 anchor，同一人物同一场景不得重复。主图最多加五张补图。
没有符合条件的出场人物，调用 skip_scene_images({reason})，不要提交空场景或编造人物。referenceOnly.selected 存在时只能画指定人物和场景，anchor 必须等于指定 anchor，不再规划补图。参考图约束稳定外貌；服装、动作和环境以本轮对应场景为准。`

export const SKIP_SCENE_IMAGES = { name: 'skip_scene_images', description: '本轮没有需要配图的参考人物实际出场时跳过，不请求图片。', parameters: {
  type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', maxLength: 300 } }
} }

export function referenceScenePeople(card, looks, bound) {
  const people = new Map(), ambiguous = new Set()
  const add = person => {
    if (!person?.name || ambiguous.has(person.name)) return
    const old = people.get(person.name)
    if (old?.id && person.id && old.id !== person.id) { people.delete(person.name); ambiguous.add(person.name); return }
    people.set(person.name, { ...old, ...person })
  }
  for (const person of card.characters || []) {
    if ((card.characters || []).filter(p => p.name === person.name).length !== 1) { ambiguous.add(person.name); continue }
    try { decodeReferenceImage(person.image); add({ name: person.name }) } catch { /* No valid image, no eligibility. */ }
  }
  for (const person of looks.people || []) if (person.approved && person.referenceMode === 'image') add({ id: person.id, name: person.name })
  for (const record of bound.records || []) add({ id: record.person.id, name: record.person.name })
  return [...people.values()].filter(person => !ambiguous.has(person.name))
}

export function assertReferenceScene(plan, people, targetText, selected) {
  if (plan.subjects?.length !== 1) throw new Error('自动配图每张必须恰好一个有参考图的人物')
  const person = plan.people?.find(p => p.id === plan.subjects[0])
  if (!person || !people.some(p => p.name === person.name && (!p.id || p.id === person.id))) throw new Error('画中人物没有可用且已授权的参考图')
  if (!plan.anchor || !targetText.includes(plan.anchor)) throw new Error('自动配图 anchor 必须是本轮出场场景的正文原句')
  if (selected && (person.name !== selected.personName || plan.anchor !== selected.anchor)) throw new Error('补图人物或场景与本轮已选方案不一致')
  const seen = new Set([person.name + '\n' + plan.anchor])
  for (const scene of plan.additionalScenes || []) {
    if (selected) throw new Error('补图不得继续扩展多图')
    if (!people.some(p => p.name === scene.personName)) throw new Error('补图 personName 必须是有参考图的人物姓名')
    if (!scene.anchor || !targetText.includes(scene.anchor)) throw new Error('补图 anchor 必须来自本轮正文')
    const key = scene.personName + '\n' + scene.anchor
    if (seen.has(key)) throw new Error('同一人物同一场景不能重复配图')
    seen.add(key)
  }
}
