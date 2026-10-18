import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createCardOrganization } from '../tavern-plugin/lib/domain/card-organization.js'
import { registerCardEditingTools } from '../tavern-plugin/lib/tools/card-editing.js'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'card-library-info-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return { dataRoot, library: createCardOrganization(createProfileDataStore({ dataRoot })) }
}
test('简介与标签默认空白、部分更新、清空、校验和重命名持久化', async t => {
  const { library, dataRoot } = await fixture(t)
  const cards = [{ path: 'cards/a.json', description: '原始设定', tags: ['原标签'] }]
  const paths = cards.map(card => card.path)
  assert.equal((await library.project(cards))[0].summary, '')
  assert.deepEqual((await library.project(cards))[0].labels, [])
  await library.update({ action: 'cards', paths, summary: '第一行\n第二行', labels: ['奇幻', ' 奇幻 ', '冒险'] }, paths)
  await library.update({ action: 'cards', paths, starred: true }, paths)
  const reopened = createCardOrganization(createProfileDataStore({ dataRoot }))
  const card = (await reopened.project(cards))[0]
  assert.equal(card.summary, '第一行\n第二行')
  assert.deepEqual(card.labels, ['奇幻', '冒险'])
  assert.equal(card.description, '原始设定')
  assert.deepEqual(card.tags, ['原标签'])
  await assert.rejects(library.update({ action: 'cards', paths, summary: 'x'.repeat(4001) }, paths))
  await assert.rejects(library.update({ action: 'cards', paths, labels: [''] }, paths))
  await library.movePath(paths[0], 'cards/new.json')
  assert.equal((await library.read()).cards['cards/new.json'].summary, card.summary)
  await library.update({ action: 'cards', paths: ['cards/new.json'], labels: [], summary: '' }, ['cards/new.json'])
  assert.equal((await library.read()).cards['cards/new.json'].summary, '')
  assert.deepEqual((await library.read()).cards['cards/new.json'].labels, [])
})
test('内置 Agent 工具读写真实磁盘，限制卡片模式，省略字段不清空', async t => {
  const { library } = await fixture(t)
  const registered = new Map(), paths = ['cards/a.json']
  let mode = 'card'
  registerCardEditingTools({ tools: { register: tool => registered.set(tool.name, tool) },
    chatForSession: async () => ({ mode, cardPath: paths[0] }),
    cardLibraryInfo: async (path, patch) => {
      if (patch.summary !== undefined || patch.labels !== undefined) await library.update({ action: 'cards', paths: [path], ...patch }, paths)
      const card = (await library.project([{ path }]))[0]
      return { path, summary: card.summary, labels: card.labels }
    }
  })
  const tool = registered.get('tavern_card_library_info'), exec = { agent: { session: { id: 's' } } }
  assert.equal((await tool.execute({}, exec)).summary, '')
  await tool.execute({ summary: '简介', labels: ['轻松'] }, exec)
  assert.deepEqual((await tool.execute({ summary: '新简介' }, exec)).labels, ['轻松'])
  assert.equal((await tool.execute({}, exec)).summary, '新简介')
  mode = 'story'
  await assert.rejects(tool.execute({ labels: [] }, exec), /卡片工作台/)
})
test('更多菜单能编辑简介和标签，保存到磁盘并用于搜索', async t => {
  const { library } = await fixture(t)
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  t.after(() => { Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close() })
  let prompt, refreshes = 0
  const cards = [{ path: 'cards/a.json', name: '测试卡' }]
  const source = await readFile(new URL('../tavern-plugin/src/client/card-organization.js', import.meta.url), 'utf8')
  const context = vm.createContext({ React, document: dom.window.document, useTavernConfirm: () => () => false,
    useLibraryPins: () => ({ order: items => items, button: () => null }),
    askTavernText: async options => { prompt = options }, notifyTavernDataChanged() {},
    rpc: async (method, args) => {
      if (method === 'getCardOrganization') return { groups: [] }
      if (method === 'setCardLibraryInfo') await library.update({ action: 'cards', paths: [args.path], ...args }, cards.map(card => card.path))
      return (await library.project(cards))[0]
    }
  })
  vm.runInContext(source, context)
  function Panel() { return context.useCardOrganization(cards, false, () => { refreshes++ }, message => { throw Error(message) }, { managing: false }).rowMenu(cards[0]) }
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => root.render(React.createElement(Panel)))
  assert.equal(dom.window.document.querySelector('summary').title, '更多')
  for (const [label, value] of [['编辑简介', '神秘的城镇'], ['编辑标签', '悬疑，探索\n悬疑']]) {
    const button = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === label)
    await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(prompt.allowEmpty, true)
    assert.equal(prompt.multiline, true)
    await act(async () => prompt.onSubmit(value))
  }
  const projected = await library.project(cards)
  assert.equal(projected[0].summary, '神秘的城镇')
  assert.deepEqual(projected[0].labels, ['悬疑', '探索'])
  assert.equal(context.filterOrganizedCards(projected, '*', '城镇').length, 1)
  assert.equal(context.filterOrganizedCards(projected, '*', '探索').length, 1)
  assert.equal(refreshes, 2)
  await act(async () => root.unmount())
})
