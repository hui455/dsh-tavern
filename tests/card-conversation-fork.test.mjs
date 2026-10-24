import assert from 'node:assert/strict'
import test from 'node:test'
import { withCardConversationTurns, recordCardForkCheckpoint } from '../tavern-plugin/lib/domain/card-conversation-fork.js'
import { forkConversationChat, assertConversationForkable } from '../tavern-plugin/lib/domain/conversation-fork.js'
import { conversationStateAtTurn } from '../tavern-plugin/lib/domain/conversation-fork-point.js'
import { retainedRevisions } from '../tavern-plugin/lib/domain/conversation-retention.js'

function legacy(turns = [1, 3, 4]) {
  return { id: 'card-chat', sessionId: 'card-session', mode: 'card', _storageRevision: 8,
    cardPath: 'cards/target.json', workspace: { draft: { name: '草稿' }, cursor: 3, sourcePaths: ['scripts/source.txt'] },
    nativeCommits: Object.fromEntries(turns.map(turn => [turn, { turn, committedAt: turn }])),
    messages: turns.flatMap(turn => [{ role: 'user', text: '问题' + turn }, { role: 'assistant', text: '回答' + turn }]) }
}

test('旧卡片记录按已提交轮次推断，不把失败跳过的原生轮号当作成功回复', () => {
  const source = legacy()
  assert.deepEqual(withCardConversationTurns(source).messages.filter(message => message.role === 'assistant').map(message => message.turn), [1, 3, 4])
  assert.equal(source.messages[1].turn, undefined)
  const truncated = legacy(Array.from({ length: 45 }, (_, i) => i + 1))
  for (let turn = 1; turn <= 5; turn++) delete truncated.nativeCommits[turn]
  const turns = withCardConversationTurns(truncated).messages.filter(message => message.role === 'assistant').map(message => message.turn)
  assert.deepEqual(turns.slice(0, 5), Array(5).fill(undefined))
  assert.deepEqual(turns.slice(5), Array.from({ length: 40 }, (_, i) => i + 6))
})

test('旧卡片从历史回复分支读取真实提交快照，排除后来工具修改的工作台状态', async () => {
  const states = new Map([[1, { ...legacy([]), _storageRevision: 1 }],
    [2, { ...legacy([1]), _storageRevision: 2, workspace: { cursor: 1, draft: { name: '当时草稿' } } }],
    [3, { ...legacy([1]), _storageRevision: 3, workspace: { cursor: 99, draft: { name: '下一轮工具修改' } } }],
    [4, { ...legacy([1, 3]), _storageRevision: 4 }]])
  const { state, turn } = await conversationStateAtTurn(states.get(4), 1, async (_id, revision) => structuredClone(states.get(revision)))
  assert.equal(turn, 1)
  assert.equal(state._storageRevision, 2)
  assert.equal(state.workspace.draft.name, '当时草稿')
  await assert.rejects(conversationStateAtTurn(states.get(4), 1, async () => undefined), /不可用/)
})

test('卡片分支保留独立工作台、偏好和资源引用，清理暂存任务且支持再次分支', async () => {
  const source = legacy()
  source.pendingCardChanges = { 5: { fields: { name: '未提交' } } }
  source.workspace.prepared = { nativeTurn: 5 }
  source.webSearchEnabled = true
  const fork = forkConversationChat(source, { chatId: 'fork', sessionId: 'fork-session' })
  assert.equal(fork.mode, 'card')
  assert.equal(fork.cardPath, source.cardPath)
  assert.equal(fork.webSearchEnabled, true)
  assert.deepEqual(fork.workspace.sourcePaths, source.workspace.sourcePaths)
  assert.deepEqual(fork.nativeCommits, {})
  assert.equal(fork.pendingCardChanges, undefined)
  assert.equal(fork.workspace.prepared, null)
  fork.workspace.draft.name = '分支草稿'
  assert.equal(source.workspace.draft.name, '草稿')
  const again = await conversationStateAtTurn(fork, 4, () => assert.fail('当前轮无需读历史'))
  assert.equal(again.state.messages.at(-1).turn, 4)
  assert.throws(() => assertConversationForkable(source, { agentRunning: true }), /仍在生成/)
})

test('卡片回合快照去重、限制数量并纳入存档保留链', async () => {
  const source = legacy([1])
  for (let turn = 2; turn <= 55; turn++) recordCardForkCheckpoint(source, turn)
  recordCardForkCheckpoint(source, 55)
  assert.equal(source.timeline.checkpoints.length, 50)
  assert.equal(source.timeline.checkpoints.at(-1).turn, 55)
  assert.deepEqual([...await retainedRevisions(source, async () => undefined, [], { keepTurns: 50 })], [8])
})
