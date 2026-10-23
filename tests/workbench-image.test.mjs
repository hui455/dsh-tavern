import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createSceneIllustrations } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { registerWorkbenchImageTool } from '../tavern-plugin/lib/tools/workbench-image.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createCardReferenceImageDefinition } from '../tavern-plugin/lib/domain/card-reference-image-view.js'
import { comfyWorkflow, compileComfyWorkflow } from '../tavern-plugin/lib/domain/scene-image-comfy-workflow.js'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')

test('workflow prompt replacement removes template art direction while preserving character LoRA settings', () => {
  const graph = comfyGraph()
  graph['3'].inputs.text = 'fixed anime style'
  graph['8'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'character.safetensors', strength_model: 0.5 } }
  graph['5'].inputs.model = ['8', 0]
  const compiled = compileComfyWorkflow(comfyWorkflow(graph), 'A lighthouse beside the sea')
  assert.equal(compiled.prompt['3'].inputs.text, 'A lighthouse beside the sea')
  assert.deepEqual(compiled.prompt['8'], graph['8'])
  assert.deepEqual(compiled.prompt['5'].inputs.model, ['8', 0])
})

test('blank and card-bound workbenches generate through HTTP and persist images without card writes; only configured style is added', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-image-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const requests = []
  let fail = false, saved = 0
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.setHeader('content-type', 'application/json')
    res.statusCode = fail ? 400 : 200
    res.end(JSON.stringify(fail ? { error: { message: 'fixture rejection' } } : { data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const service = createSceneIllustrations({
    store: createProfileDataStore({ dataRoot: join(root, 'data') }),
    credentials: () => ({ resolve: async () => ({ value: 'fixture-key' }), set: async () => {} }),
    attachments: () => ({ saveImage: async image => {
      const attachmentId = 'image-' + ++saved
      await writeFile(join(root, attachmentId), image.data)
      return { attachmentId, mediaType: image.mediaType }
    } })
  })
  t.after(() => service.dispose())
  await service.configure({ provider: 'openai', model: 'test-image', baseURL: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'fixture-key' })
  await service.configure({ enabled: true })
  let chat = { id: 'workbench', mode: 'card', cardPath: '' }
  const tools = new Map()
  registerWorkbenchImageTool({ tools: { register: tool => tools.set(tool.name, tool) }, chatForSession: async () => chat,
    generateImage: input => service.generateWorkbenchImage(input) })
  const tool = tools.get('tavern_generate_image'), exec = { agent: { session: { id: 'workbench' } } }
  const orchestrator = createTurnOrchestrator({ store: { chatForSession: async () => chat }, frameBuilder: createForegroundFrameBuilder() })
  assert.ok((await orchestrator.visibleTools('workbench')).includes(tool.name))
  for (const [preset, custom, cardPath] of [
    ['auto', '', ''], ['auto', '水彩、低饱和', ''], ['custom', 'photography, natural light', 'cards/existing.json'], ['auto', '', 'cards/existing.json']
  ]) {
    chat = { ...chat, cardPath }
    const before = structuredClone(chat)
    await service.configure({ style: { preset, custom } })
    const output = await tool.execute({ prompt: 'A solitary lighthouse beside the sea', aspectRatio: '16:9' }, exec)
    const result = JSON.parse(output)
    assert.equal(result.generated, true)
    assert.deepEqual(await readFile(join(root, result.imageId)), png)
    assert.equal(tool.output.render({}, output)[1].attachment.attachmentId, result.imageId)
    assert.deepEqual(chat, before)
    const prompt = requests.at(-1).prompt
    if (custom) assert.ok(prompt.includes(custom))
    else assert.equal(prompt, 'A solitary lighthouse beside the sea', 'no implicit art style or person injected')
  }
  const count = requests.length
  for (const input of [{ prompt: '' }, { prompt: 'x'.repeat(12001) }, { prompt: 'valid', aspectRatio: 'bad' }]) await assert.rejects(tool.execute(input, exec))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(tool.execute({ prompt: 'cancelled' }, { ...exec, signal: controller.signal }))
  assert.equal(requests.length, count)
  fail = true
  await assert.rejects(tool.execute({ prompt: 'request failure' }, exec), /不要自动重复请求/)
  assert.equal(requests.length, count + 1)
  await service.configure({ enabled: false })
  await assert.rejects(tool.execute({ prompt: 'disabled' }, exec), /开启并配置/)
  chat.mode = 'story'
  assert.ok(!(await orchestrator.visibleTools('workbench')).includes(tool.name))
  await assert.rejects(tool.execute({ prompt: 'wrong mode' }, exec), /卡片工作台/)
})

test('free image tool results remain visible after transcript folding and deduplicate reference reads', () => {
  const def = createCardReferenceImageDefinition(), context = { key: 'free:1', id: '1', matches: [] }
  let seq = 0
  function send(type, data = {}) {
    const event = { type, seq: ++seq, data: { turn: 1, ...data } }, match = def.match(event)
    const entry = { event, location: { kind: 'test' } }; context.matches.push(entry)
    context.state = match.role === 'start' ? def.start(context, entry) : def.update(context, entry)
  }
  const attachment = { attachmentId: 'free-image', mediaType: 'image/png' }
  send('turn/start')
  for (const [name, callId] of [['tavern_generate_image', 'generate'], ['tavern_character_reference', 'read']]) {
    send('tool/call', { name, callId })
    send('tool/result', { message: { content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'image', attachment }] }] } })
  }
  send('assistant/message'); const answerSeq = seq; send('turn/end')
  const view = def.buildViewNode(context)
  assert.equal(view.anchorSeq, answerSeq)
  assert.equal(view.data.images.length, 1)
  assert.deepEqual(view.data.images[0].attachment, attachment)
})
