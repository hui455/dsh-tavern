import { imageExtension } from './cast-assets.js'
import { imageReferenceCapability } from './scene-image-reference.js'
import { statesBareClothing, stripGarmentTags } from './scene-tag-filter.js'

export const VISUAL_REFERENCE_KEY = 'dsh_visual_references'
const MAX_BYTES = 8 * 1024 * 1024
const media = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function visualReferenceDocument(workspace) {
  const raw = workspace?.raw || workspace || {}, data = object(raw.data) ? raw.data : raw
  const saved = data.extensions?.[VISUAL_REFERENCE_KEY]
  if (saved == null) return { version: 1, revision: 0, characters: [] }
  if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.characters) || saved.characters.length > 32) throw new Error('人物参考资料格式无效')
  return structuredClone(saved)
}
export function encodeReferenceImage(image) {
  const bytes = Buffer.from(image.data || [])
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('参考图须为不超过 8 MiB 的 PNG、JPEG 或 WebP')
  const mediaType = media[imageExtension(bytes)]
  if (!mediaType) throw new Error('参考图仅支持 PNG、JPEG 或 WebP')
  return { mediaType, base64: bytes.toString('base64') }
}
export function decodeReferenceImage(image) {
  if (!image || typeof image.base64 !== 'string' || image.base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw new Error('参考图数据无效')
  const data = Buffer.from(image.base64, 'base64'), checked = encodeReferenceImage({ data })
  if (checked.mediaType !== image.mediaType) throw new Error('参考图格式与内容不一致')
  return { data, mediaType: checked.mediaType }
}
export function referenceSummary(document) {
  return { revision: document.revision, characters: document.characters.map(({ image, ...person }) => ({ ...person, hasImage: Boolean(image) })) }
}
export function updateVisualReferences(workspace, input, image) {
  const doc = visualReferenceDocument(workspace)
  if (input.expectedRevision !== doc.revision) throw new Error('参考资料已变化，请先读取最新 revision 后重试')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 100) throw new Error('人物名称须为 1–100 字符')
  const existing = doc.characters.find(person => person.name === name)
  if (input.action === 'remove') doc.characters = doc.characters.filter(person => person.name !== name)
  else {
    const next = { ...(existing || {}), name }
    for (const [field, limit] of [['text', 4000], ['tags', 4000], ['generationPrompt', 12000]]) if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].length > limit) throw new Error(field + ' 必须为不超过 ' + limit + ' 字符的文字')
      next[field] = input[field].trim()
    }
    if (input.clearImage === true) delete next.image
    if (image) next.image = encodeReferenceImage(image)
    if (!next.text && !next.image) throw new Error('至少保存参考文字或参考图之一')
    doc.characters = [...doc.characters.filter(person => person.name !== name), next]
    if (doc.characters.length > 32) throw new Error('每张卡最多保存 32 个人物参考')
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 24 * 1024 * 1024) throw new Error('这张卡的参考资料超过 24 MiB，请减少或压缩参考图')
  doc.revision++
  const raw = workspace.raw || workspace, data = object(raw.data) ? raw.data : raw
  const root = object(raw.data) ? '/data' : ''
  return { document: doc, operation: { op: 'set', path: root + '/extensions', value: { ...(data.extensions || {}), [VISUAL_REFERENCE_KEY]: doc } } }
}
export function sessionReferenceImages(events) {
  const images = new Map()
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (value.type === 'image' && value.attachment?.attachmentId) images.set(value.attachment.attachmentId, value.attachment)
    if (Array.isArray(value)) { for (const item of value) visit(item) }
    else for (const item of Object.values(value)) visit(item)
  }
  for (const event of events) visit(event.data)
  return [...images.values()]
}
/** Explicit per-card references override proposed appearance, never block defaults. */
export function applyCardVisualReferences(source, document, config) {
  const plan = structuredClone(source), capability = imageReferenceCapability(config), images = [], warnings = []
  const matchedIds = [], changedIds = []
  for (const person of plan.people || []) {
    if (!plan.subjects?.includes(person.id)) continue
    const matches = document.characters.filter(ref => ref.name === person.name)
    if (matches.length !== 1 || plan.people.filter(p => p.name === person.name).length !== 1) continue
    const ref = matches[0]; matchedIds.push(person.id)
    if (ref.text) {
      changedIds.push(person.id)
      person.fields = { ...person.fields, appearance: { text: ref.text } }
      const block = plan.blocks?.find(b => b.owner === person.id && b.field === 'appearance')
      if (block) { block.text = ref.text; block.tags = ref.tags || ref.text }
      else (plan.blocks ||= []).push({ owner: person.id, field: 'appearance', text: ref.text, tags: ref.tags || ref.text })
    }
    if (ref.image && capability.supported && images.length < capability.maxImages) {
      try { images.push({ ...decodeReferenceImage(ref.image), personId: person.id, name: person.name, description: ref.text || '', reference: { kind: 'card-visual-reference', name: person.name, revision: document.revision } }) }
      catch { warnings.push('人物卡参考图不可用，改用参考文字或当前剧情。') }
    }
  }
  if (changedIds.length) {
    const scene = field => plan.blocks?.find(b => b.owner === 'scene' && b.field === field)?.tags
    plan.prompt = [scene('composition'), ...plan.subjects.map(id => {
      const person = plan.people.find(p => p.id === id)
      const blocks = plan.blocks.filter(b => b.owner === id)
      const bare = statesBareClothing(blocks.find(b => b.field === 'clothing')?.tags)
      return person.name + ': ' + blocks.map(b => b.field === 'appearance' && bare ? stripGarmentTags(b.tags) : b.tags).filter(Boolean).join(', ')
    }), scene('environment')].filter(Boolean).join('\n')
  }
  return { plan, images, warnings, matchedIds }
}
