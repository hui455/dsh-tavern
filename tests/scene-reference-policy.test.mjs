import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'
import { createSceneIllustrations } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { referenceScenePeople, assertReferenceScene } from '../tavern-plugin/lib/domain/scene-reference-policy.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const image = { mediaType: 'image/png', base64: png.toString('base64') }
const refs = () => ({ characters: [{ name: '林岚', image, text: '成年女性，银发', tags: 'adult woman, silver hair' }, { name: '林薇', image, text: '成年女性，红发', tags: 'adult woman, red hair' }] })
const text = '林岚与林薇站在窗边看雨。随后林岚独自走进花园。路人提到远方的姐姐。'

async function fixture(t, { references = refs(), respond, failAt = 0, provider = 'openai' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scene-reference-policy-'))
  const requests = [], inputs = [], paths = [], saved = new Map()
  const server = createServer(async (req, res) => {
    paths.push(req.url)
    if (req.url.includes('/history/')) {
      const id = req.url.split('/').at(-1)
      res.end(JSON.stringify({ [id]: { status: { completed: true }, outputs: { '7': { images: [{ filename: 'fixture.png', subfolder: '', type: 'output' }] } } } })); return
    }
    if (req.url.startsWith('/v1/view?')) { res.end(png); return }
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ url: req.url, body, prompt: provider === 'comfyui' ? body.prompt['3'].inputs.text : body.prompt })
    res.writeHead(requests.length === failAt ? 504 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(requests.length === failAt ? { error: { message: 'timeout' } } : provider === 'comfyui' ? { prompt_id: body.prompt_id } : { data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chat = { id: 'reference-chat', mode: 'story', settleStatus: 'done', messages: [{ role: 'assistant', turn: 2, sourceText: text }] }
  const store = createProfileDataStore({ dataRoot: root })
  const state = { references }
  const service = createSceneIllustrations({ store, chatForSession: async () => structuredClone(chat), selection: async () => ({ model: 'fixture' }),
    cardReferencesForChat: async () => structuredClone(state.references),
    credentials: () => ({ resolve: async () => ({ value: 'fixture-key' }), set: async () => {} }),
    attachments: () => ({ readImage: async ref => ({ ...saved.get(ref.attachmentId), ref }), saveImage: async value => {
      const ref = { attachmentId: 'image-' + saved.size, mediaType: value.mediaType }; saved.set(ref.attachmentId, value); return ref
    } }),
    runAgent: async input => { const data = JSON.parse(input.messages[0].content[0].text); inputs.push(data); await respond(input, data, state) }
  })
  t.after(async () => { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await service.configure({ provider, ...(provider === 'comfyui' ? { workflow: comfyGraph(), authType: 'none' } : {}), baseURL: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-image-test', apiKey: 'fixture-key' })
  await service.configure({ enabled: true, auto: true })
  return { service, requests, inputs, state, chat, saved, paths }
}
async function finish(fx) {
  for (let i = 0; i < 250; i++) {
    const state = await fx.service.status('parent', 2)
    if (state.status !== 'running' && !state.sequenceRunning) return state
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('fixture timed out')
}
async function submit(input, { name = '林岚', anchor = '林岚与林薇站在窗边看雨。', extras = [], subjects = ['p'] } = {}) {
  await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'p', name, fields: { appearance: { text: '成年女性', tags: 'adult woman' } } } })
  await input.onToolCall({ name: 'submit_scene_layout', arguments: { subjects, description: name + '单人场景', anchor, continuity: 'uncertain', viewpoint: 'first-person',
    scene: { composition: { text: '单人近景', tags: 'solo, close-up' } }, additionalScenes: extras } })
  return input.onToolCall({ name: 'submit_scene_plan', arguments: {} })
}

test('no saved references skips before any planner or paid request', async t => {
  const fx = await fixture(t, { references: { characters: [{ name: '林薇', image: { mediaType: 'image/png', base64: 'bad' } }] } })
  await fx.service.autoGenerate('parent')
  const status = await finish(fx)
  assert.equal(status.stage, 'skipped'); assert.equal(status.outcome, 'not_requested')
  assert.equal(fx.inputs.length, 0); assert.equal(fx.requests.length, 0)
  assert.equal(await fx.service.autoGenerate('parent'), null)
})
test('offscreen/mentioned reference people can skip without a generated image', async t => {
  const fx = await fixture(t, { respond: async input => {
    assert.match(input.system, /回忆、转述、只被提及/)
    await input.onToolCall({ name: 'skip_scene_images', arguments: { reason: '人物只被提及，没有实际出场' } })
    assert.equal(input.stopToolsWhen(), true)
  } })
  fx.chat.messages[0].sourceText = '路人谈起远方的林岚和林薇，两人都不在这里。'
  await fx.service.autoGenerate('parent'); assert.equal((await finish(fx)).stage, 'skipped')
  assert.equal(fx.requests.length, 0)
  await fx.service.autoGenerate('parent'); assert.equal(fx.inputs.length, 1)
})
for (const provider of ['openai', 'comfyui']) for (const failAt of [0, 2]) test('reference prose plans separate text-only scenes: ' + provider + '/' + failAt, async t => {
  const fx = await fixture(t, { failAt, provider, respond: async (input, data) => {
    assert.deepEqual(data.referenceOnly.people.map(p => p.name), ['林岚', '林薇'])
    const selected = data.referenceOnly.selected
    const output = await submit(input, selected ? { name: selected.personName, anchor: selected.anchor } : { extras: [
      { personName: '林薇', anchor: '林岚与林薇站在窗边看雨。', description: '林薇看雨', viewpoint: 'first-person' },
      { personName: '林岚', anchor: '随后林岚独自走进花园。', description: '林岚走进花园', viewpoint: 'first-person' }
    ] })
    assert.doesNotMatch(output, /方案校验失败/)
  } })
  await fx.service.autoGenerate('parent'); const state = await finish(fx)
  assert.equal(state.status, 'succeeded', state.error)
  assert.equal(fx.requests.length, failAt || 3)
  assert.equal(fx.saved.size, failAt ? 1 : 3)
  for (const request of fx.requests) { assert.equal(request.url, provider === 'comfyui' ? '/v1/prompt' : '/v1/images/generations'); assert.match(request.prompt, /Solo/); assert.doesNotMatch(JSON.stringify(request.body), /iVBOR|sourceImages|referenceImages|LoadImage/) }
  assert.ok(fx.paths.every(path => !path.includes('upload') && !path.includes('edits')))
  if (provider === 'comfyui') { const graph = fx.requests[0].body.prompt; const original = comfyGraph(); assert.deepEqual(Object.keys(graph).sort(), Object.keys(original).sort()); assert.deepEqual(graph['1'], original['1']); assert.deepEqual(graph['5'].inputs.model, original['5'].inputs.model) }
  assert.match(fx.requests[0].prompt, /Saved character appearance: adult woman, silver hair/); assert.match(fx.requests[1].prompt, /Saved character appearance: adult woman, red hair/)
  assert.equal(state.extras[0].outcome, failAt ? 'unconfirmed' : 'received')
  await fx.service.autoGenerate('parent'); assert.equal(fx.requests.length, failAt || 3)
})
test('removed reference cancels stale planning before generation', async t => {
  const fx = await fixture(t, { respond: async (input, data, state) => { state.references = { characters: [] }; await submit(input) } })
  await fx.service.autoGenerate('parent'); const state = await finish(fx)
  assert.equal(state.status, 'failed'); assert.equal(state.outcome, 'not_requested'); assert.match(state.error, /参考资料已变化/)
  assert.equal(fx.requests.length, 0)
  // A manual retry of an automatic picture must not escape the saved policy.
  await fx.service.start('parent', 2, state.key, { requestId: 'retry-without-reference' })
  assert.equal((await finish(fx)).stage, 'skipped'); assert.equal(fx.requests.length, 0)
})
test('planner cannot dispatch an unreferenced character or multiple subjects', async t => {
  const fx = await fixture(t, { respond: async input => {
    assert.match(await submit(input, { name: '路人' }), /没有已保存的参考资料/)
    assert.match(await submit(input, { subjects: ['p', 'q'] }), /恰好一个/)
    await input.onToolCall({ name: 'skip_scene_images', arguments: { reason: '没有合适的单人场景' } })
  } })
  await fx.service.autoGenerate('parent'); assert.equal((await finish(fx)).stage, 'skipped')
  assert.equal(fx.requests.length, 0)
})
test('saved text references remain eligible on ComfyUI without image bytes', async t => {
  const fx = await fixture(t, { provider: 'comfyui', references: { characters: [{ name: '林岚', text: '成年女性，银发', tags: 'adult woman, silver hair' }] },
    respond: async (input, data) => { assert.match(data.referenceOnly.people[0].text, /银发/); await submit(input) } })
  await fx.service.autoGenerate('parent'); assert.equal((await finish(fx)).status, 'succeeded')
  assert.equal(fx.requests.length, 1); assert.match(fx.requests[0].prompt, /silver hair/)
  assert.ok(fx.paths.every(path => !path.includes('upload')))
})
test('policy rejects multi-person, unreferenced, duplicate and mismatched scenes', () => {
  const people = referenceScenePeople(refs(), { people: [] }, { records: [] })
  const plan = { subjects: ['p'], people: [{ id: 'p', name: '林岚' }], anchor: '林岚与林薇站在窗边看雨。' }
  assertReferenceScene(plan, people, text)
  for (const bad of [{ ...plan, subjects: ['p', 'q'] }, { ...plan, people: [{ id: 'p', name: '路人' }] },
    { ...plan, anchor: '不在本轮的场景' }, { ...plan, additionalScenes: [{ personName: '林岚', anchor: plan.anchor }] }]) assert.throws(() => assertReferenceScene(bad, people, text))
  assert.throws(() => assertReferenceScene(plan, people, text, { personName: '林薇', anchor: plan.anchor }))
  assert.deepEqual(referenceScenePeople({ characters: [{ name: '同名', image }, { name: '同名', image }] }, {}, {}), [])
})

test('planning uses approved and bound reference prose independently of image-provider consent', () => {
  const people = referenceScenePeople({ characters: [] }, { people: [{ id: 'a', name: '林岚', approved: true, referenceMode: 'text',
    confirmed: { appearance: '银发', tags: 'silver hair' } }] }, { records: [], active: [{ person: { id: 'b', name: '林薇', description: '红发' } }] })
  assert.deepEqual(people, [{ id: 'a', name: '林岚', text: '银发', tags: 'silver hair' }, { id: 'b', name: '林薇', text: '红发' }])
})
