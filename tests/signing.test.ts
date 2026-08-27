import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sign, signingPayload, verify } from '../lib/signing.ts'

const SECRET = 'shared_secret'
const base = {
  timestamp: '1756300000',
  method: 'POST',
  path: '/api/checkout_sessions',
  body: '{"items":[]}',
}

const payload = signingPayload(base)
const signature = sign(SECRET, payload)

test('a signature verifies against the material that produced it', () => {
  assert.equal(verify(SECRET, payload, signature), true)
})

test('a different secret does not verify', () => {
  assert.equal(verify('other_secret', payload, signature), false)
})

test('changing any signed component invalidates the signature', () => {
  const variants = [
    { ...base, timestamp: '1756300001' },
    { ...base, method: 'PUT' },
    { ...base, path: '/api/checkout_sessions/cs_1/complete' },
    { ...base, body: '{"items":[{"product_id":"x","quantity":1}]}' },
  ]

  for (const variant of variants) {
    assert.equal(verify(SECRET, signingPayload(variant), signature), false)
  }
})

test('method is compared case-insensitively', () => {
  assert.equal(signingPayload({ ...base, method: 'post' }), payload)
})

test('a malformed signature is rejected rather than throwing', () => {
  assert.equal(verify(SECRET, payload, 'v1=short'), false)
  assert.equal(verify(SECRET, payload, ''), false)
})
