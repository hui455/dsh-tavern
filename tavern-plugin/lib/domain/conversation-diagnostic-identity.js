export function conversationDiagnosticIdentity(chat, requestedSessionId) {
  if (!chat?.id || !chat.sessionId) throw new Error('当前会话没有绑定 Tavern 对话')
  const turns = (chat.messages || []).filter(item => item.role === 'assistant').map(item => Number(item.turn || (item.greeting ? 1 : 0)))
  const identity = { chatId: chat.id, sessionId: chat.sessionId, mode: chat.mode || 'story', turn: turns.filter(Number.isSafeInteger).reduce((latest, turn) => Math.max(latest, turn), 0) }
  if (requestedSessionId && requestedSessionId !== chat.sessionId) identity.agentSessionId = requestedSessionId
  return { ...identity, text: ['对话 ID: ' + identity.chatId, 'Session ID: ' + identity.sessionId,
    ...(identity.agentSessionId ? ['Agent Session ID: ' + identity.agentSessionId] : []), '轮次: ' + identity.turn].join('\n') }
}
