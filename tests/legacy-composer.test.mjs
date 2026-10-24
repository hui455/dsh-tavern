import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { helperClient } from './fixtures/helper-host-harness.mjs'

function mount(send, managed = false) {
  const nodes = []
  function element() {
    return { value: '', append(...items) { nodes.push(...items) }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn } }
  }
  const document = { body: element(), createElement: element, getElementById(id) { return nodes.find(n => n.id === id) } }
  const html = helperClient.buildTavernFrameDocument({ token: 'send', content: '<p>opening</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-legacy-composer>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  vm.runInNewContext(source, { document, window: managed ? { submitTavernInput: send } : { triggerSlash: send }, console: { error() {} } })
  return { nodes, area: document.getElementById('send_textarea'), button: document.getElementById('send_but') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('failed legacy send retains payload, displays failure and permits retry', async () => {
  const { nodes, area, button } = mount(() => Promise.reject(new Error('发送失败')))
  area.value = '开始故事'; button.click(); await tick()
  assert.equal(area.value, '开始故事')
  assert.equal(button.disabled, false)
  assert.ok(nodes.some(n => /开局消息发送失败/.test(n.textContent)))
})

function hostComposer() {
  const dom = new JSDOM('<iframe id="a"></iframe><iframe id="b"></iframe>')
  const doc = dom.window.document, drafts = [], sends = [], errors = []
  const releases = ['a', 'b'].map(id => helperClient.installFrameHostComposer(doc,
    node => node === doc.getElementById(id), text => sends.push({ id, text }),
    error => errors.push(error), text => drafts.push({ id, text })))
  return { dom, doc, drafts, sends, errors, releases,
    area: doc.getElementById('send_textarea'), button: doc.getElementById('send_but'),
    input(text) { this.area.value = text; this.area.dispatchEvent(new dom.window.Event('input', { bubbles: true })) } }
}

test('trusted frame input drafts into its own conversation without sending, including empty and pipe text', async () => {
  const h = hostComposer()
  h.doc.getElementById('b').focus()
  h.input('候选 | /trigger\n第二行'); await tick()
  assert.deepEqual(h.drafts, [{ id: 'b', text: '候选 | /trigger\n第二行' }])
  h.input(''); await tick()
  assert.deepEqual(h.drafts[1], { id: 'b', text: '' })
  assert.equal(h.sends.length, 0)
  assert.equal(h.errors.length, 0)
  h.releases.forEach(release => release()); h.dom.window.close()
})

test('input followed by immediate send cannot leave a duplicate draft', async () => {
  const h = hostComposer()
  h.doc.getElementById('a').focus()
  h.input('发送此条'); h.button.click(); await tick()
  assert.deepEqual(h.sends, [{ id: 'a', text: '发送此条' }])
  assert.deepEqual(h.drafts, [])
  h.releases.forEach(release => release()); h.dom.window.close()
})

test('a removed frame cannot draft into another conversation', async () => {
  const h = hostComposer()
  h.doc.getElementById('a').focus()
  h.input('旧消息'); h.releases[0](); await tick()
  assert.deepEqual(h.drafts, [])
  h.doc.getElementById('a').focus(); h.input('无归属'); await tick()
  assert.deepEqual(h.drafts, [])
  h.releases[1](); h.dom.window.close()
})
