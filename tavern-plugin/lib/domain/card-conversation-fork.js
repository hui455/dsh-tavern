import { randomUUID } from 'node:crypto'
import { FORK_HISTORY_TURNS } from './conversation-fork-targets.js'

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
