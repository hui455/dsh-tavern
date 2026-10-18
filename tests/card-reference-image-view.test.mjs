import test from 'node:test'
import assert from 'node:assert/strict'
import { createCardReferenceImageDefinition } from '../tavern-plugin/lib/domain/card-reference-image-view.js'

test('legacy reference tool images stay visible after compact folding, deduplicate reads, and ignore other tools/errors', () => {
  const def = createCardReferenceImageDefinition(), context = { key: 'ref:1', id: '1', matches: [] }
  let seq = 0
  function send(type, data) {
    const event = { type, seq: ++seq, data: { turn: 1, ...data } }, match = def.match(event)
    if (!match) return
    const entry = { event, location: { kind: 'test' } }; context.matches.push(entry)
    context.state = match.role === 'start' ? def.start(context, entry) : def.update(context, entry)
  }
  const attachment = { attachmentId: 'sha256:fixture', mediaType: 'image/png' }
  const result = (id, isError = false) => ({ message: { content: [{ type: 'tool-result', toolCallId: id, isError, content: [{ type: 'text', text: 'saved' }, { type: 'image', attachment }] }] } })
  send('turn/start', {})
  send('tool/call', { name: 'other_tool', callId: 'other' }); send('tool/result', result('other'))
  assert.equal(def.buildViewNode(context), null)
  send('tool/call', { name: 'tavern_character_reference', callId: 'generate' }); send('tool/result', result('generate', true))
  assert.equal(def.buildViewNode(context), null)
  send('tool/result', result('generate'))
  const during = def.buildViewNode(context)
  assert.equal(during.anchorSeq, seq); assert.equal(during.data.images.length, 1)
  send('tool/call', { name: 'tavern_character_reference', callId: 'read' }); send('tool/result', result('read'))
  send('assistant/message', {})
  const answerSeq = seq
  send('turn/end', {})
  const after = def.buildViewNode(context)
  assert.equal(after.anchorSeq, answerSeq)
  assert.equal(after.visibility, 'visible')
  assert.deepEqual(after.data.images, [{ attachment }])
})
