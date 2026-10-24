import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

const input = { baseURL: 'https://example.org/v1', apiKey: 'fixture-private-key', model: 'image-test', prompt: 'A window' }
test('504 preserves uncertain outcome and never resends or falls back from edits', async () => {
  let calls = 0
  await assert.rejects(generateSceneImage({ ...input, provider: 'openai', sourceImages: [{ data: Buffer.from('fixture'), mediaType: 'image/png' }] }, {
    fetch: async (url, init) => {
      calls++; assert.ok(url.endsWith('/images/edits')); assert.ok(init.body instanceof FormData)
      assert.equal(init.headers['content-type'], undefined)
      return new Response('<html>Gateway Timeout</html>', { status: 504 })
    }
  }), error => { assert.equal(error.imageOutcome, 'unconfirmed'); assert.equal(error.imageFailure.httpStatus, 504); assert.match(error.message, /扣费状态未确认/); return true })
  assert.equal(calls, 1)
})

test('unsupported editing provider and invalid source images fail before dispatch', async () => {
  let calls = 0
  for (const options of [{ provider: 'grok', sourceImages: [] }, { provider: 'openai', sourceImages: [] },
    { provider: 'openai', sourceImages: [{ data: Buffer.from('x'), mediaType: 'text/plain' }] }]) {
    await assert.rejects(generateSceneImage({ ...input, ...options }, { fetch: async () => { calls++; throw new Error('unexpected request') } }))
  }
  assert.equal(calls, 0)
})
test('provider rejection retains actionable details but not echoed credentials or unrelated response data', async () => {
  await assert.rejects(generateSceneImage(input, { fetch: async () => Response.json({
    error: { message: 'Unsupported size; key=fixture-private-key Bearer other-private-token', param: 'size', code: 'invalid_parameter' },
    debug: 'private response data'
  }, { status: 400 }) }), error => {
    assert.match(error.message, /HTTP 400.*Unsupported size/s)
    assert.equal(error.imageFailure.param, 'size')
    assert.equal(error.imageFailure.code, 'invalid_parameter')
    assert.equal(error.imageOutcome, 'rejected')
    assert.doesNotMatch(JSON.stringify({message: error.message, failure: error.imageFailure}), /fixture-private-key|other-private-token|private response data/)
    return true
  })
})
