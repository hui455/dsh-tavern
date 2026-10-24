import { randomUUID } from 'node:crypto'
import { FORK_HISTORY_TURNS } from './conversation-fork-targets.js'
import { sessionEvents } from './session-events.js'

// Older workbench replies omitted their native turn. Successful commits still
// identify the tail of that history (the commit log retains its latest 40 turns).
export function withCardConversationTurns(chat) {
  if (chat?.mode !== 'card') return chat
  const replies = (chat.messages || []).filter(message => message?.role === 'assistant')
  const turns = Object.values(chat.nativeCommits || {}).map(commit => Number(commit?.turn))
    .filter(turn => Number.isSafeInteger(turn) && turn > 0).sort((a, b) => a - b)
  if (!turns.length) return chat
  const inferred = new Map(replies.slice(-turns.length).map((message, index) => [message, turns[index]]))
  return { ...chat, messages: (chat.messages || []).map(message =>
    message?.role === 'assistant' && !message.turn && inferred.get(message)
      ? { ...message, turn: inferred.get(message) } : message) }
}

// Record the settled state before a new workbench turn edits its cursor/draft.
// These links also keep the required revisions alive during save maintenance.
export function recordCardForkCheckpoint(chat, turn) {
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isSafeInteger(chat._storageRevision)) return
  const previous = chat.timeline || {}
  const checkpoints = previous.checkpoints || []
  if (checkpoints.some(checkpoint => Number(checkpoint.turn) === turn)) return
  chat.timeline = { schemaVersion: 1, branchId: previous.branchId || 'branch-' + randomUUID(),
    revision: 0, operations: {}, participants: {}, ...previous,
    checkpoints: [...checkpoints, { id: 'card-turn-' + turn, turn, beforeRevision: chat._storageRevision }].slice(-FORK_HISTORY_TURNS) }
}

// The host retains non-turn events after the selected turn/end. That suffix
// can contain the source's next queued prompt. It belongs to the old future,
// not the fork, and must be canceled before opening/driving the new Agent.
export function discardInheritedCardForkInput(session, agent) {
  const events = sessionEvents(session)
  const seedEnd = events.find(event => event.type === 'session/end-seed')?.seq
  const inheritedIds = new Set(events.filter(event => typeof session.isOwnSeq === 'function'
    ? !session.isOwnSeq(event.seq) : seedEnd !== undefined && event.seq < seedEnd)
    .filter(event => event.type === 'agent/inbox/spliced')
    .flatMap(event => (event.data?.inserted || []).map(message => message.id)))
  if (!inheritedIds.size) return 0
  if (!agent?.inbox) throw new Error('分叉目标的输入队列尚未就绪，请重试')
  const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(message => inheritedIds.has(message.id))
  for (const message of pending) agent.inbox.remove(message.id)
  return pending.length
}
