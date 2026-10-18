import { normalizeResourcePath, resourceKind } from './file-resources.js'

const FILE = 'library-pins.json'
const kinds = ['card', 'preset', 'worldbook']
export function createLibraryPins(store) {
  function validate(kind, path) {
    const normalized = normalizeResourcePath(path)
    if (!kinds.includes(kind) || !(kind === resourceKind(normalized) || kind === 'worldbook' && resourceKind(normalized) === 'card')) throw Error('置顶资源类型不正确')
    return normalized
  }
  const read = async () => (await store.readJson(FILE)) || {}
  async function set(kind, path, pinned) {
    path = validate(kind, path)
    if (typeof pinned !== 'boolean') throw Error('置顶状态无效')
    return store.updateJson(FILE, current => {
      const state = current || {}
      const paths = new Set(state[kind] || [])
      if (pinned) paths.add(path)
      else paths.delete(path)
      return { ...state, [kind]: [...paths] }
    })
  }
  async function movePath(from, to) {
    return store.updateJson(FILE, current => Object.fromEntries(kinds.map(kind => [kind,
      [...new Set(((current || {})[kind] || []).flatMap(path => path === from ? (to ? [to] : []) : [path]))]
    ])))
  }
  return { read, set, movePath }
}
