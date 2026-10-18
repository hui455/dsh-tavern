import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundSceneTool, foregroundScenePlanForTurn, matchingForegroundPlans, foregroundSceneInstructions } from '../tavern-plugin/lib/domain/foreground-scene-plans.js'
const layout = { description: '窗边', subjects: [], continuity: 'uncertain', anchor: '她站在窗边。', scene: { composition: { text: '主观视角', tags: 'first person view, window' } }, viewpoint: 'first-person', aspectRatio: '3:4' }
test('foreground plans are validated, hidden in tool metadata, bound to active operation and final text', async () => {
  let settings = { enabled: true, promptSource: 'main' }
  let chat = { mode: 'story', timeline: { operations: { op: { id: 'op', kind: 'body', turn: 2, status: 'running' } } } }
  const session = { id: 's', events: [{ type: 'turn/start', data: { turn: 2 } }] }
  const tool = createForegroundSceneTool({ settings: async () => settings, chatForSession: async () => chat })
  const exec = { agent: { session } }
  const result = await tool.execute({ scenes: [{ characters: [], layout }] }, exec)
  assert.equal(tool.output.render({}, result).length, 1)
  assert.doesNotMatch(tool.output.render({}, result)[0].text, /first person view/)
  const meta = tool.output.presentationMeta({}, result)
  session.events.push({ type: 'tool/result', data: { turn: 2, meta, message: { content: [{ type: 'tool-result', isError: false }] } } })
  const saved = foregroundScenePlanForTurn(session, { turn: 2, operationId: 'op', sourceText: '她站在窗边。' })
  assert.equal(matchingForegroundPlans({ source: '她站在窗边。', foregroundScenePlan: saved }).length, 1)
  assert.equal(matchingForegroundPlans({ source: '她走了。', foregroundScenePlan: saved }), null)
  assert.equal(foregroundScenePlanForTurn(session, { turn: 2, operationId: 'different', sourceText: '' }), undefined)
  await assert.rejects(tool.execute({ scenes: [{ characters: [], layout: { ...layout, viewpoint: 'bad' } }] }, exec), /viewpoint/)
  chat.mode = 'card'; await assert.rejects(tool.execute({ scenes: [{ characters: [], layout }] }, exec), /未开启/)
  settings.promptSource = 'independent'; assert.equal(foregroundSceneInstructions(settings), '')
})

import { pathToFileURL } from 'node:url'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
test('real DSH foreground tool metadata is reusable for image HTTP generation without a planning Agent', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { defineTool } = await import(new URL('../../dsh-tools/lib/index.js', bootUrl))
  let host, runtime, step = 0
  runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { setupHost(ctx) {
    host = ctx
    ctx.tools.register(createForegroundSceneTool({ settings: async () => ({ enabled: true, promptSource: 'main' }), chatForSession: async () => ({ mode: 'story', timeline: { operations: { op: { id: 'op', kind: 'body', turn: 1, status: 'running' } } } }) }))
    class MainModel extends LlmAdapter {
      async *stream() {
        const block = step++ === 0 ? { type: 'tool-call', id: 'main-scenes', name: 'tavern_submit_scene_images', arguments: JSON.stringify({ scenes: [{ characters: [], layout }] }) } : { type: 'text', text: '她站在窗边。' }
        yield { type: 'block-start', index: 0, blockType: block.type }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['main-scene-fixture'], new MainModel())
  } })
  t.after(() => runtime.dispose())
  const handle = await host.agents.create({ sessionId: 'main-plan', seed: [], agentOptions: { provider: 'main-scene-fixture', model: 'fixture' } })
  t.after(() => handle.dispose())
  handle.agent.followup({ id: 'user-request', role: 'user', content: [{ type: 'text', text: '继续剧情并规划配图' }], source: { kind: 'human' } })
  await handle.agent.whenIdle()
  const saved = foregroundScenePlanForTurn(handle.agent.session, { turn: 1, operationId: 'op', sourceText: '她站在窗边。' })
  assert.ok(saved, 'native tool/result must retain presentationMeta')
  Object.assign(runtime.chat.messages[0], { sourceText: '她站在窗边。', swipes: ['她站在窗边。'], foregroundScenePlan: saved })
  await runtime.service.configure({ promptSource: 'main' })
  const target = await runtime.service.status('scene-parent', 1)
  await runtime.service.start('scene-parent', 1, target.key)
  let final
  for (let i = 0; i < 300; i++) { final = await runtime.service.status('scene-parent', 1); if (final.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.equal(final.status, 'succeeded', final.error)
  assert.equal(final.planSource, 'main')
  assert.equal(runtime.requests.length, 0)
  assert.equal(runtime.imageRequests.length, 1)
})
