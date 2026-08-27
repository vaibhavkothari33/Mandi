import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

const ctx = freshDb()

const { claim, fingerprint, record, release } = await import('../lib/idempotency.ts')
const { ApiError } = await import('../lib/http.ts')

after(async () => ctx.cleanup())

const PATH = '/api/checkout_sessions'
const hashA = fingerprint('POST', PATH, '{"items":[]}')
const hashB = fingerprint('POST', PATH, '{"items":[{"product_id":"x","quantity":1}]}')

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    return err instanceof ApiError ? err.code : 'not_api_error'
  }
  return 'no_error'
}

test('the first claim on a key proceeds', () => {
  assert.equal(claim('key_1', PATH, hashA), null)
})

test('a duplicate arriving before the response is refused as in flight', () => {
  claim('key_2', PATH, hashA)
  assert.equal(code(() => claim('key_2', PATH, hashA)), 'request_in_progress')
})

test('once recorded, a replay returns the stored response verbatim', () => {
  claim('key_3', PATH, hashA)
  record('key_3', 201, { id: 'cs_original' })

  const replayed = claim('key_3', PATH, hashA)
  assert.deepEqual(replayed, { status: 201, body: { id: 'cs_original' } })
})

test('the same key with a different body is refused, not replayed', () => {
  claim('key_4', PATH, hashA)
  record('key_4', 201, { id: 'cs_original' })
  assert.equal(code(() => claim('key_4', PATH, hashB)), 'idempotency_key_reuse')
})

test('a released claim can be retried', () => {
  claim('key_5', PATH, hashA)
  release('key_5')
  assert.equal(claim('key_5', PATH, hashA), null)
})

test('release does not discard a completed response', () => {
  claim('key_6', PATH, hashA)
  record('key_6', 201, { id: 'cs_kept' })
  release('key_6')

  assert.deepEqual(claim('key_6', PATH, hashA), { status: 201, body: { id: 'cs_kept' } })
})

test('a request fingerprint covers method, path and body', () => {
  assert.notEqual(fingerprint('POST', PATH, '{}'), fingerprint('POST', '/other', '{}'))
  assert.notEqual(fingerprint('POST', PATH, '{}'), fingerprint('DELETE', PATH, '{}'))
  assert.equal(fingerprint('post', PATH, '{}'), fingerprint('POST', PATH, '{}'))
})
