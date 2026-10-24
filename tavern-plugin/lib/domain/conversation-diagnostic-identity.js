export function conversationDiagnosticIdentity(chat, requestedSessionId, sceneRecords = []) {
  if (!chat?.id || !chat.sessionId) throw new Error('当前会话没有绑定 Tavern 对话')
  const turns = (chat.messages || []).filter(item => item.role === 'assistant').map(item => Number(item.turn || (item.greeting ? 1 : 0)))
  const identity = { chatId: chat.id, sessionId: chat.sessionId, mode: chat.mode || 'story', turn: turns.filter(Number.isSafeInteger).reduce((latest, turn) => Math.max(latest, turn), 0) }
  if (requestedSessionId && requestedSessionId !== chat.sessionId) identity.agentSessionId = requestedSessionId
  const image = sceneRecords.filter(item => item.turn === identity.turn && item.targetKey !== 'interaction' && item.requestId).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0]
  if (image) identity.imageRequestId = image.requestId
  if (image?.traceSessionId) identity.imageAgentSessionId = image.traceSessionId
  return { ...identity, text: ['对话 ID: ' + identity.chatId, 'Session ID: ' + identity.sessionId,
    ...(identity.agentSessionId ? ['Agent Session ID: ' + identity.agentSessionId] : []), '轮次: ' + identity.turn,
    ...(identity.imageRequestId ? ['生图请求 ID: ' + identity.imageRequestId] : []),
    ...(identity.imageAgentSessionId ? ['生图 Agent Session ID: ' + identity.imageAgentSessionId] : [])].join('\n') }
}
