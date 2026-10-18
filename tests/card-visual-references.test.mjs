import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createSceneIllustrations } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { registerCardVisualReferenceTool } from '../tavern-plugin/lib/tools/card-visual-references.js'
import { visualReferenceDocument, encodeReferenceImage, decodeReferenceImage, applyCardVisualReferences } from '../tavern-plugin/lib/domain/card-visual-references.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
test('card tool writes portable references and reverse edits through real card preparation/orchestrator, rejecting stale or foreign images', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-card-reference-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'card.json'), cards = createCardPreparation()
  await writeFile(file, JSON.stringify(cards.create({ kind: 'import', payload: { name: '林岚', description: '成年女性，黑色长发。性格沉稳。', extensions: { unrelated: { keep: true } } } })))
  const read = async () => JSON.parse(await readFile(file, 'utf8'))
  let chat = { id: 'workbench', mode: 'card', cardPath: 'cards/林岚.json' }
  const store = { chatForSession: async () => structuredClone(chat), writeChat: async value => { chat = value },
    updateCard: async (_path, patch, revision, rawOperations) => {
      const result = cards.update({ kind: 'card', card: await read(), patch, revision, rawOperations })
      await writeFile(file, JSON.stringify(result.card))
      return { ...result, card: result.view }
    } }
  const orchestrator = createTurnOrchestrator({ store, cards, frameBuilder: createForegroundFrameBuilder() }), tools = new Map()
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ path: req.url, body: JSON.parse(body) })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const service = createSceneIllustrations({ store: createProfileDataStore({ dataRoot: join(root, 'data') }),
    credentials: () => ({ resolve: async () => ({ value: 'fixture-key' }), set: async () => {} }),
    attachments: () => ({ saveImage: async () => ({ attachmentId: 'generated-image', mediaType: 'image/png' }) }) })
  t.after(() => service.dispose())
  await service.configure({ provider: 'openai', model: 'test-image', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-key' })
  await service.configure({ enabled: true })
  registerCardVisualReferenceTool({ tools: { register: tool => tools.set(tool.name, tool) }, chatForSession: store.chatForSession, readCardWorkspace: read,
    generateReference: input => service.generateCardReference(input),
    turnOrchestrator: orchestrator, activeTurnOf: () => 1, attachments: () => ({ readImage: async () => ({ data: png }), saveImage: async () => ({ attachmentId: 'stored-image', mediaType: 'image/png' }) }) })
  const tool = tools.get('tavern_character_reference'), exec = { agent: { session: { id: 'workbench', events: [{ type: 'user/message', data: { message: { content: [{ type: 'image', attachment: { attachmentId: 'uploaded-image', mediaType: 'image/png' } }] } } }] } } }
  const call = async args => JSON.parse(await tool.execute(args, exec))
  assert.ok((await orchestrator.visibleTools('workbench')).includes(tool.name))
  assert.equal((await call({ action: 'list' })).availableImages[0].attachmentId, 'uploaded-image')
  await assert.rejects(call({ action: 'upsert', name: '林岚', expectedRevision: 0, imageId: 'other-chat-image' }), /本次卡片对话/)
  await call({ action: 'upsert', name: '林岚', expectedRevision: 0, text: '成年女性，银色短发', tags: 'adult woman, short silver hair', imageId: 'uploaded-image' })
  const stored = visualReferenceDocument(await read())
  assert.equal(stored.revision, 1)
  assert.deepEqual(decodeReferenceImage(stored.characters[0].image).data, png)
  const output = await tool.execute({ action: 'read', name: '林岚' }, exec)
  assert.equal(tool.output.render({}, output)[1].type, 'image')
  await assert.rejects(call({ action: 'remove', name: '林岚', expectedRevision: 0 }), /已变化/)
  await assert.rejects(call({ action: 'update_description', name: '林岚', description: '新描述', expectedDescription: '旧的错误描述' }), /人物描述已变化/)
  await call({ action: 'update_description', name: '林岚', description: '成年女性，银色短发。性格沉稳。', expectedDescription: '成年女性，黑色长发。性格沉稳。' })
  const exported = cards.present({ card: await read(), as: 'sillytavern-v3' })
  assert.equal(exported.data.description, '成年女性，银色短发。性格沉稳。')
  assert.equal(exported.data.extensions.unrelated.keep, true)
  assert.equal(visualReferenceDocument(exported).characters[0].image.base64, png.toString('base64'))
  await assert.rejects(call({ action: 'generate', name: '林岚', text: '成年女性，银色短发', prompt: '' }), /完整生图描述/)
  const generated = await tool.execute({ action: 'generate', name: '林岚', text: '成年女性，银色短发', prompt: 'Adult woman, short silver hair, neutral background, portrait' }, exec)
  const generatedResult = JSON.parse(generated)
  assert.equal(generatedResult.saved, true)
  const autoSaved = visualReferenceDocument(await read()).characters[0]
  assert.equal(autoSaved.text, '成年女性，银色短发')
  assert.match(autoSaved.generationPrompt, /short silver hair/)
  assert.ok(autoSaved.image)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/v1/images/generations')
  assert.match(requests[0].body.prompt, /short silver hair/)
  exec.agent.session.events.push({ type: 'tool/result', data: { content: tool.output.render({}, generated) } })
  const current = await call({ action: 'list' })
  assert.ok(current.availableImages.some(image => image.attachmentId === generatedResult.imageId))
  await call({ action: 'upsert', name: '林岚', imageId: generatedResult.imageId, expectedRevision: current.revision })
  assert.deepEqual(decodeReferenceImage(visualReferenceDocument(await read()).characters[0].image).data, png)
  await assert.rejects(call({ action: 'upsert', name: '林岚', imageId: generatedResult.imageId, expectedRevision: current.revision }), /已变化/)
  assert.equal(requests.length, 1, 'save conflicts never regenerate')
  await service.configure({ enabled: false })
  await assert.rejects(call({ action: 'generate', name: '林岚', text: '成年女性，银色短发', prompt: 'portrait' }), /开启并配置/)
  chat.mode = 'story'
  assert.ok(!(await orchestrator.visibleTools('workbench')).includes(tool.name))
  await assert.rejects(call({ action: 'list' }), /卡片工作台/)
  await assert.rejects(call({ action: 'generate', name: '林岚', text: '成年女性，银色短发', prompt: 'portrait' }), /卡片工作台/)
})

test('card references use images only on supported channels, preserve default plans and ignore malformed images', () => {
  const source = { subjects: ['p'], people: [{ id: 'p', name: '林岚', fields: {} }], blocks: [{ owner: 'scene', field: 'composition', tags: 'portrait' }], prompt: 'original default prompt' }
  const doc = { version: 1, revision: 1, characters: [{ name: '林岚', text: '银发', tags: 'silver hair', image: encodeReferenceImage({ data: png }) }] }
  assert.equal(applyCardVisualReferences(source, { characters: [] }, {}).plan.prompt, source.prompt)
  const textOnly = applyCardVisualReferences(source, doc, { provider: 'comfyui' })
  assert.equal(textOnly.images.length, 0)
  assert.match(textOnly.plan.prompt, /silver hair/)
  assert.equal(source.prompt, 'original default prompt')
  const config = { provider: 'gemini', model: 'gemini-3.1-flash-image' }
  assert.deepEqual(applyCardVisualReferences(source, doc, config).images[0].data, png)
  doc.characters[0].image.base64 = 'invalid'
  const bad = applyCardVisualReferences(source, doc, config)
  assert.equal(bad.images.length, 0)
  assert.equal(bad.warnings.length, 1)
  assert.match(bad.plan.prompt, /silver hair/)
})
