import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createLibraryPins } from '../tavern-plugin/lib/domain/library-pins.js'

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'library-pins-'))
  t.after(() => rm(dataRoot, { force: true, recursive: true }))
  return { dataRoot, pins: createLibraryPins(createProfileDataStore({ dataRoot })) }
}
test('三库置顶独立持久化，并发修改不丢失，重命名跟随和删除清理', async t => {
  const { dataRoot, pins } = await fixture(t)
  await Promise.all([
    pins.set('card', 'cards/a.json', true),
    pins.set('worldbook', 'cards/a.json', true),
    pins.set('preset', 'presets/a.json', true),
    pins.set('worldbook', 'worldbooks/b.json', true)
  ])
  const reopened = createLibraryPins(createProfileDataStore({ dataRoot }))
  assert.equal((await reopened.read()).worldbook.length, 2)
  await pins.set('card', 'cards/a.json', false)
  assert.deepEqual((await pins.read()).card, [])
  assert.ok((await pins.read()).worldbook.includes('cards/a.json'))
  await pins.movePath('cards/a.json', 'cards/new.json')
  assert.ok((await pins.read()).worldbook.includes('cards/new.json'))
  await pins.movePath('cards/new.json', null)
  assert.deepEqual((await pins.read()).worldbook, ['worldbooks/b.json'])
  await assert.rejects(pins.set('preset', 'cards/a.json', true))
  await assert.rejects(pins.set('card', '../cards/a.json', true))
  await assert.rejects(pins.set('preset', 'presets/a.json', 'true'))
})

test('真实 React 点击置顶、重挂载恢复、取消置顶和保存失败提示', async t => {
  const { pins } = await fixture(t)
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close() })
  let fail = false, error = ''
  const usePins = vm.runInNewContext((await readFile(new URL('../tavern-plugin/src/client/modules/library-pins.js', import.meta.url), 'utf8')) + '\nuseLibraryPins', {
    React, window: dom.window, Event: dom.window.Event,
    rpc: async (method, args) => {
      if (fail && method === 'setLibraryPin') throw Error('磁盘写入失败')
      return method === 'getLibraryPins' ? pins.read() : pins.set(args.kind, args.path, args.pinned)
    }
  })
  const container = dom.window.document.getElementById('root')
  let root = createRoot(container)
  async function settle() { await new Promise(resolve => setTimeout(resolve, 60)) }
  for (const [kind, prefix] of [['card', 'cards'], ['preset', 'presets'], ['worldbook', 'worldbooks']]) {
    function Panel() {
      const model = usePins(kind, value => { error = value })
      return React.createElement('div', null, model.order(['a', 'b', 'c'].map(name => ({ name, path: prefix + '/' + name + '.json' }))).map(item =>
        React.createElement('div', { key: item.path, 'data-name': item.name }, item.name, model.button(item.path, false))))
    }
    await act(async () => { root.render(React.createElement(Panel)) })
    await act(settle)
    await act(async () => { container.querySelector('[data-name="b"] button').click(); await settle() })
    assert.equal(container.querySelector('[data-name]').dataset.name, 'b')
    assert.equal(container.querySelector('button').textContent, '取消置顶')
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => { root.render(React.createElement(Panel)) })
    await act(settle)
    assert.equal(container.querySelector('[data-name]').dataset.name, 'b')
    fail = true
    await act(async () => { container.querySelector('button').click(); await settle() })
    assert.equal(error, '磁盘写入失败')
    assert.equal(container.querySelector('[data-name]').dataset.name, 'b')
    fail = false
    await act(async () => { container.querySelector('button').click(); await settle() })
    assert.deepEqual([...container.querySelectorAll('[data-name]')].map(node => node.dataset.name), ['a', 'b', 'c'])
  }
  await act(async () => root.unmount())
})
