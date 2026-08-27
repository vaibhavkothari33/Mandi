import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { freshDb } from './helpers.ts'

const ctx = freshDb()

const { db } = await import('../lib/db/client.ts')
const { issueCart, issueIntent } = await import('../lib/mandate/issue.ts')
const { verifyCart, verifyIntent, verifyMandate } = await import('../lib/mandate/verify.ts')
const { consume, drawdown, usageCount } = await import('../lib/mandate/store.ts')
const { encode } = await import('../lib/mandate/jws.ts')
const { ensureKeypair } = await import('../lib/mandate/keys.ts')

after(async () => ctx.cleanup())

const SUBJECT = 'user_demo'
const AGENT = 'agent_demo_buyer'

const newIntent = (overrides: Record<string, unknown> = {}) =>
  issueIntent({ subject: SUBJECT, agent: AGENT, scope: { max_amount_paise: 100000 }, ...overrides })

const newCart = (intentJti: string, amount = 25000, overrides: Record<string, unknown> = {}) =>
  issueCart({
    subject: SUBJECT,
    agent: AGENT,
    intentJti,
    sessionId: 'cs_test',
    cartHash: 'hash_abc',
    amountPaise: amount,
    ...overrides,
  })

const codeOf = (verdict: { ok: boolean; code?: string }) => (verdict.ok ? 'ok' : verdict.code)

test('a freshly issued intent verifies', () => {
  const intent = newIntent()
  const verdict = verifyIntent(intent.jws)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.ok && verdict.payload.scope.max_amount_paise, 100000)
})

test('a freshly issued cart mandate verifies', () => {
  const intent = newIntent()
  assert.equal(verifyCart(newCart(intent.payload.jti).jws).ok, true)
})

test('altering the payload invalidates the signature', () => {
  const intent = newIntent()
  const [header, payload, signature] = intent.jws.split('.')

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  decoded.scope.max_amount_paise = 999999999
  const forged = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`

  assert.equal(codeOf(verifyIntent(forged)), 'mandate_bad_signature')
})

test('an expired mandate is refused', () => {
  const intent = newIntent({ ttlSeconds: -10 })
  assert.equal(codeOf(verifyIntent(intent.jws)), 'mandate_expired')
})

test('a mandate of the wrong kind is refused', () => {
  const intent = newIntent()
  assert.equal(codeOf(verifyMandate(intent.jws, 'cart')), 'mandate_wrong_kind')
})

test('a mandate signed by an unknown key is refused', () => {
  const stranger = generateKeyPairSync('ed25519')
  const privateKey = stranger.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')

  const forged = encode(
    { alg: 'EdDSA', typ: 'mandate+jws', kid: 'key_not_ours' },
    { jti: 'mdt_forged', kind: 'intent', sub: SUBJECT, aud: 'mrc_mandi_demo', agent: AGENT, iat: 1, exp: 9_999_999_999 },
    privateKey,
  )

  assert.equal(codeOf(verifyIntent(forged)), 'mandate_unknown_key')
})

test('a validly signed but unregistered mandate is refused', () => {
  const key = ensureKeypair()
  const forged = encode(
    { alg: 'EdDSA', typ: 'mandate+jws', kid: key.kid },
    {
      jti: 'mdt_never_issued',
      kind: 'intent',
      sub: SUBJECT,
      aud: 'mrc_mandi_demo',
      agent: AGENT,
      scope: { max_amount_paise: 1, currency: 'INR', categories: null, max_uses: null },
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    key.privateKey!,
  )

  assert.equal(codeOf(verifyIntent(forged)), 'mandate_unregistered')
})

test('swapping the stored token for an identifier is detected', () => {
  const first = newIntent()
  const second = newIntent()
  db().prepare('UPDATE mandates SET jws = ? WHERE id = ?').run(second.jws, first.payload.jti)

  assert.equal(codeOf(verifyIntent(first.jws)), 'mandate_substituted')
})

test('a cart mandate can only be consumed once', () => {
  const intent = newIntent()
  const cart = newCart(intent.payload.jti)

  assert.equal(verifyCart(cart.jws).ok, true)
  assert.equal(consume(cart.payload.jti), true)
  assert.equal(consume(cart.payload.jti), false)
  assert.equal(codeOf(verifyCart(cart.jws)), 'mandate_already_used')
})

test('drawdown counts only consumed cart mandates', () => {
  const intent = newIntent()
  const jti = intent.payload.jti

  const a = newCart(jti, 10000)
  const b = newCart(jti, 15000)
  newCart(jti, 90000)

  assert.equal(drawdown(jti), 0)
  consume(a.payload.jti)
  assert.equal(drawdown(jti), 10000)
  consume(b.payload.jti)
  assert.equal(drawdown(jti), 25000)
  assert.equal(usageCount(jti), 2)
})
