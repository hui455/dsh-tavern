// Promote durable tool images outside the compact transcript's folded process.
// Read existing content, so images from older conversations need no regeneration.
function createCardReferenceImageDefinition() {
  return {
    kind: 'tavern-card-reference-images', target: 'chat',
    match(event) {
      const turn = event.data?.turn
      if (!Number.isSafeInteger(turn)) return null
      if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
      if (['turn/end', 'assistant/message', 'tool/call', 'tool/result'].includes(event.type)) return { id: String(turn), role: 'update' }
      return null
    },
    start(_context, match) { return { turn: match.event.data.turn, calls: [], images: [] } },
    update(context, match) {
      const state = context.state, event = match.event, data = event.data
      if (event.type === 'assistant/message') return { ...state, answerSeq: event.seq }
      if (event.type === 'turn/end') return { ...state, endSeq: event.seq }
      if (event.type === 'tool/call' && data.name === 'tavern_character_reference') return { ...state, calls: [...state.calls, data.callId] }
      if (event.type !== 'tool/result') return state
      const images = [...state.images]
      for (const result of data.message?.content || []) {
        if (result.type !== 'tool-result' || result.isError || !state.calls.includes(result.toolCallId)) continue
        for (const block of result.content || []) {
          const attachment = block.type === 'image' && block.attachment
          if (!attachment?.attachmentId || !attachment.mediaType?.startsWith('image/')) continue
          if (!images.some(item => item.attachment.attachmentId === attachment.attachmentId)) images.push({ attachment })
        }
      }
      return { ...state, images, imageSeq: images.length > state.images.length ? event.seq : state.imageSeq }
    },
    buildViewNode(context) {
      const state = context.state
      if (!state?.images.length) return null
      return { key: context.key, kind: 'tavern-card-reference-images', id: context.id, target: 'chat',
        anchorSeq: state.endSeq !== undefined ? state.answerSeq ?? state.endSeq : state.imageSeq,
        location: context.matches.at(-1)?.location ?? context.start?.location ?? { kind: 'unresolved' },
        visibility: 'visible', data: { turn: state.turn, images: state.images } }
    }
  }
}
export { createCardReferenceImageDefinition }
