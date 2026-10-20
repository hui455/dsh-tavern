import test from 'node:test'
import assert from 'node:assert/strict'
import { comfyWorkflow, compileComfyWorkflow } from '../tavern-plugin/lib/domain/scene-image-comfy-workflow.js'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

import { comfyGraph, comfyLinkedSeedGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const input = () => ({ provider: 'comfyui', baseURL: 'http://localhost:8188/prefix', workflow: comfyGraph(), prompt: 'rainy window' })

test('Impact wildcard API selectors survive import without allowing secrets or nested unsafe keys', () => {
  const workflow = comfyWorkflow(comfyGraph())
  workflow.prompt['3'].class_type = 'ImpactWildcardEncode'
  workflow.prompt['3'].inputs['Select to add LoRA'] = 'Select the LoRA to add to the text'
  workflow.prompt['3'].inputs['Select to add Wildcard'] = 'Select the Wildcard to add to the text'
  const imported = comfyWorkflow(workflow)
  assert.equal(compileComfyWorkflow(imported, 'scene').prompt['3'].inputs['Select to add LoRA'], 'Select the LoRA to add to the text')
  for (const key of ['token', 'password', 'api_key', 'authorization', '__proto__', 'constructor', 'prototype']) {
    const copy = structuredClone(workflow)
    Object.defineProperty(copy.prompt['3'].inputs, key, { value: 'PRIVATE_SENTINEL', enumerable: true })
    assert.throws(() => comfyWorkflow(copy), error => /危险字段/.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'))
  }
  const nested = structuredClone(workflow)
  nested.prompt['3'].inputs.nested = { 'Select to add LoRA': 'x' }
  assert.throws(() => comfyWorkflow(nested), /危险字段/)
  workflow.prompt['3'].class_type = 'OtherNode'
  assert.throws(() => comfyWorkflow(workflow), /危险字段/)
})

test('ComfyUI mapping errors identify missing fields, types, unsafe integers and duplicates without leaking values', () => {
  for (const [value, expected] of [['PRIVATE_SENTINEL', /节点 8.*seed.*安全整数/], [2 ** 53, /节点 8.*seed.*安全整数/], [1.5, /节点 8.*seed.*安全整数/]]) {
    const graph = comfyLinkedSeedGraph(); graph['8'].inputs.seed = value
    assert.throws(() => comfyWorkflow(graph), error => expected.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'))
  }
  const missing = comfyLinkedSeedGraph(); delete missing['8'].inputs.seed
  assert.throws(() => comfyWorkflow(missing), /节点 8.*seed.*不存在/)
  const duplicate = comfyWorkflow(comfyGraph())
  duplicate.bindings.seed.push({ ...duplicate.bindings.seed[0] })
  assert.throws(() => comfyWorkflow(duplicate), /映射重复.*节点 5.*seed/)
  const linked = comfyWorkflow(comfyLinkedSeedGraph())
  linked.bindings.seed = [{ node: '5', input: 'seed' }]
  assert.throws(() => comfyWorkflow(linked), /节点 5.*seed.*连接.*源节点/)
  const badPositive = comfyWorkflow(comfyGraph()); badPositive.prompt['3'].inputs.text = 5
  assert.throws(() => comfyWorkflow(badPositive), /节点 3.*text.*字符串/)
})

test('ComfyUI rejects canvas files, secrets, cycles, broken links and ambiguous prompt mapping before HTTP', () => {
  assert.throws(() => comfyWorkflow({ nodes: [], links: [] }), /API/)
  for (const mutate of [
    g => { g['3'].inputs.token = 'secret' },
    g => { g['5'].inputs.positive = ['4', 0] },
    g => { g['6'].inputs.samples = ['6', 0] },
    g => { g['6'].inputs.samples = ['missing', 0] },
    g => { g['2'].inputs.__proto__ = 'x'; g['2'].inputs = JSON.parse('{"__proto__":"x"}') }
  ]) { const graph = comfyGraph(); mutate(graph); assert.throws(() => comfyWorkflow(graph), /工作流/) }
  const graph = comfyGraph(); graph['2'].inputs.batch_size = ['1', 0]
  assert.throws(() => compileComfyWorkflow(comfyWorkflow(graph), 'scene'), /批量/)
})

test('ComfyUI lost submit response reconciles queued task and never POSTs again, including unknown history', async () => {
  let saved, posts = 0
  const params = { ...input(), onProviderTask: async task => { saved = task } }
  await assert.rejects(generateSceneImage(params, { fetch: async () => { posts++; throw new Error('connection lost') } }), /connection lost/)
  assert.equal(saved.state, 'submitting')
  const initial = saved
  let reads = 0
  const result = await generateSceneImage({ ...params, providerTask: initial }, { wait: async () => {}, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST')
    if (url.endsWith('/queue')) return Response.json({ queue_pending: [[0, initial.promptId, {}, { client_id: initial.clientId }]], queue_running: [] })
    if (url.includes('/history/')) return Response.json(reads++ === 0 ? {} : { [initial.promptId]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } })
    return new Response(png)
  } })
  assert.deepEqual(result.data, png); assert.equal(posts, 1)
  await assert.rejects(generateSceneImage({ ...params, providerTask: initial }, { fetch: async (_url, init) => { assert.notEqual(init.method, 'POST'); return Response.json({}) } }), /结果未确认/)
})

test('ComfyUI error history is terminal even with completed:false; rejected submission and cancellation do not retry', async () => {
  let saved, posts = 0
  const params = { ...input(), onProviderTask: async task => { saved = task } }
  await assert.rejects(generateSceneImage(params, { fetch: async (url) => {
    if (url.endsWith('/prompt')) { posts++; return Response.json({ prompt_id: saved.promptId }) }
    return Response.json({ [saved.promptId]: { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'private key' }]] } } })
  } }), error => /执行失败/.test(error.message) && !error.message.includes('private key'))
  assert.equal(saved.state, 'failed'); assert.equal(posts, 1)
  await assert.rejects(generateSceneImage(params, { fetch: async () => new Response('secret', { status: 400 }) }), /HTTP 400/)
  assert.equal(saved.state, 'rejected')
  const controller = new AbortController()
  await assert.rejects(generateSceneImage({ ...params, signal: controller.signal }, { wait: async () => { controller.abort() }, fetch: async url => url.endsWith('/prompt') ? Response.json({ prompt_id: saved.promptId }) : Response.json({}) }), /abort/i)
  assert.equal(saved.state, 'pending')
})
import { createServer } from 'node:http'
import { COMFY_ASPECT_RATIOS } from '../tavern-plugin/lib/domain/scene-image-comfy-workflow.js'
import { channelSettings } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { updateSceneDraft, assembleSceneDraft } from '../tavern-plugin/lib/domain/scene-plan-draft.js'

function ratioWorkflow() {
  const workflow = comfyWorkflow(comfyGraph())
  workflow.prompt['2'].inputs.width = 864
  workflow.prompt['2'].inputs.height = 1152
  workflow.bindings.width = [{ node: '2', input: 'width' }]
  workflow.bindings.height = [{ node: '2', input: 'height' }]
  return comfyWorkflow(workflow)
}
test('Comfy ratios preserve pixel budget, exact ratio and 8 alignment; reject malformed mappings', () => {
  const workflow = ratioWorkflow()
  for (const aspectRatio of COMFY_ASPECT_RATIOS) {
    const compiled = compileComfyWorkflow(workflow, 'scene', { aspectRatio })
    const { width, height } = compiled.prompt['2'].inputs
    const [a, b] = aspectRatio.split(':').map(Number)
    assert.equal(width * b, height * a)
    assert.equal(width % 8, 0); assert.equal(height % 8, 0)
    assert.ok(Math.abs(width * height / (864 * 1152) - 1) < 0.2)
    assert.equal(compiled.generationParameters.width[0].value, width)
  }
  assert.equal(channelSettings({ provider: 'comfyui', workflow }).aspectRatio, 'auto')
  const missing = structuredClone(workflow); delete missing.bindings.height
  assert.throws(() => comfyWorkflow(missing), /成对/)
  const linked = structuredClone(workflow); linked.prompt['2'].inputs.width = ['1', 0]
  assert.throws(() => comfyWorkflow(linked), /连接/)
  assert.throws(() => compileComfyWorkflow(workflow, 'scene', { aspectRatio: '100:1' }), /比例/)
  assert.throws(() => channelSettings({ provider: 'comfyui', workflow: comfyGraph(), aspectRatio: 'auto' }), /宽高映射/)
  assert.equal(compileComfyWorkflow(workflow, 'scene').prompt['2'].inputs.width, 864)
})
test('AI layout ratio reaches real Comfy HTTP request; fixed settings win and missing ratio falls back to 3:4', async t => {
  const received = []
  let id
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/prompt') {
      let text = ''; for await (const chunk of req) text += chunk
      const body = JSON.parse(text); received.push(body.prompt); id = body.prompt_id
      res.end(JSON.stringify({ prompt_id: id }))
    } else if (req.url.startsWith('/history/')) res.end(JSON.stringify({ [id]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'fixture.png', subfolder: '', type: 'output' }] } } } }))
    else { res.setHeader('content-type', 'image/png'); res.end(png) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const workflow = ratioWorkflow(), baseURL = `http://127.0.0.1:${server.address().port}`
  const draft = updateSceneDraft(undefined, 'submit_scene_layout', { description: 'wide scene', subjects: [], continuity: 'uncertain', scene: {}, aspectRatio: '21:9', orientation: 'landscape' })
  const plan = assembleSceneDraft(draft)
  for (const [settings, chosenPlan, expected] of [['auto', plan, '21:9'], ['3:4', plan, '3:4'], ['auto', {}, '3:4'], ['auto', { orientation: 'square' }, '1:1']]) {
    const result = await generateSceneImage({ provider: 'comfyui', baseURL, workflow, prompt: 'test scene', aspectRatio: settings, plan: chosenPlan })
    assert.deepEqual(result.data, png)
    const { width, height } = received.at(-1)['2'].inputs
    const [a, b] = expected.split(':').map(Number); assert.equal(width * b, height * a)
  }
  assert.equal(received.length, 4)
})
import { isComfyConnectionRefused, comfySubmissionWasRefused } from '../tavern-plugin/lib/domain/scene-image-comfy.js'

test('only definite connection refusal permits a new ComfyUI submission', () => {
  const refused = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
  assert.equal(isComfyConnectionRefused(new TypeError('fetch failed', { cause: refused })), true)
  assert.equal(isComfyConnectionRefused(new AggregateError([refused, refused])), true)
  for (const error of [new Error('ECONNREFUSED'), Object.assign(new Error(), { code: 'ECONNRESET' }), new AggregateError([refused, new Error('unknown')]), new AggregateError([])]) assert.equal(isComfyConnectionRefused(error), false)
})

test('legacy retry recovery requires exact task POST refusal evidence', () => {
  const task = { provider:'comfyui', state:'submitting', promptId:'one', clientId:'client', baseURL:'http://localhost:8188', workflowDigest:'digest' }
  const events = [{requestId:1,method:'POST',phase:'dispatch'}, {requestId:1,method:'POST',phase:'transport-error',networkCodes:['ECONNREFUSED']}]
  const attempt = {providerTask:task,providerRequests:events}
  assert.equal(comfySubmissionWasRefused(task,[attempt]),true)
  assert.equal(comfySubmissionWasRefused(task,[{...attempt,providerTask:{...task,baseURL:task.baseURL+'/'}}]),true)
  assert.equal(comfySubmissionWasRefused(task,[{providerTask:task,providerRequests:[{method:'GET',phase:'response',status:200}]}]),false)
  for (const change of [{promptId:'other'},{clientId:'other'},{baseURL:'http://other'},{workflowDigest:'other'},{state:'pending'}]) assert.equal(comfySubmissionWasRefused(task,[{...attempt,providerTask:{...task,...change}}]),false)
  assert.equal(comfySubmissionWasRefused(task,[{...attempt,droppedProviderEvents:1}]),false)
  for (const networkCodes of [[],['ECONNRESET'],['ECONNREFUSED','ETIMEDOUT']]) assert.equal(comfySubmissionWasRefused(task,[{...attempt,providerRequests:[events[0],{...events[1],networkCodes}]}]),false)
  assert.equal(comfySubmissionWasRefused(task,[{...attempt,providerRequests:[...events,{requestId:1,method:'POST',phase:'response',status:200}]}]),false)
})

test('real refused TCP connection persists rejection; explicit retry submits exactly once after server starts', async t => {
  const {createServer}=await import('node:http')
  const server=createServer((req,res)=>{
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      if(req.url==='/prompt'){posts++;id=JSON.parse(Buffer.concat(chunks)).prompt_id;res.setHeader('content-type','application/json');res.end(JSON.stringify({prompt_id:id}))}
      else if(req.url.startsWith('/history/'))res.end(JSON.stringify({[id]:{status:{completed:true},outputs:{'7':{images:[{filename:'fixture.png',subfolder:'',type:'output'}]}}}}))
      else {res.setHeader('content-type','image/png');res.end(png)}
    })
  })
  let posts=0,id,saved
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
  await new Promise(r=>server.close(r))
  t.after(()=>{server.closeAllConnections();server.close()})
  const params={...input(),baseURL:'http://127.0.0.1:'+port,onProviderTask:async task=>{saved=task}}
  await assert.rejects(generateSceneImage(params),e=>e.imageOutcome==='not_requested'&&/未送达/.test(e.message))
  assert.equal(saved.state,'rejected');assert.equal(saved.rejectionReason,'connection-refused');assert.equal(posts,0)
  const previous=saved.promptId
  await new Promise(r=>server.listen(port,'127.0.0.1',r))
  const result=await generateSceneImage(params)
  assert.deepEqual(result.data,png);assert.equal(posts,1);assert.notEqual(saved.promptId,previous)
})
