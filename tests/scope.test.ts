import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCartWithinIntent } from '../lib/mandate/scope.ts'
import type { CartPayload, IntentPayload } from '../lib/mandate/types.ts'

const now = Math.floor(Date.now() / 1000)

const intent = (scope: Partial<IntentPayload['scope']> = {}): IntentPayload => ({
  jti: 'mdt_intent',
  kind: 'intent',
  sub: 'user_demo',
  aud: 'mrc_mandi_demo',
  agent: 'agent_demo_buyer',
  scope: {
    max_amount_paise: 100000,
    currency: 'INR',
    categories: null,
    max_uses: null,
    ...scope,
  },
  iat: now,
  exp: now + 3600,
})

const cart = (overrides: Partial<CartPayload> = {}): CartPayload => ({
  jti: 'mdt_cart',
  kind: 'cart',
  sub: 'user_demo',
  aud: 'mrc_mandi_demo',
  agent: 'agent_demo_buyer',
  intent_jti: 'mdt_intent',
  session_id: 'cs_1',
  cart_hash: 'hash_abc',
  amount_paise: 25000,
  currency: 'INR',
  iat: now,
  exp: now + 300,
  ...overrides,
})

const run = (opts: Partial<Parameters<typeof checkCartWithinIntent>[0]> = {}) =>
  checkCartWithinIntent({
    cart: cart(),
    intent: intent(),
    categories: ['grocery'],
    alreadySpentPaise: 0,
    alreadyUsed: 0,
    ...opts,
  })

const codeOf = (v: { ok: boolean; code?: string }) => (v.ok ? 'ok' : v.code)

test('a cart inside its intent is allowed', () => {
  assert.equal(codeOf(run()), 'ok')
})

test('a cart exceeding the limit outright is refused', () => {
  assert.equal(codeOf(run({ cart: cart({ amount_paise: 100001 }) })), 'scope_amount_exceeded')
})

test('a cart is measured against remaining authority, not the original limit', () => {
  assert.equal(codeOf(run({ alreadySpentPaise: 80000, cart: cart({ amount_paise: 20000 }) })), 'ok')
  assert.equal(codeOf(run({ alreadySpentPaise: 80000, cart: cart({ amount_paise: 20001 }) })), 'scope_amount_exceeded')
  // The same cart that fits a fresh intent is refused once authority is drawn down.
  assert.equal(codeOf(run({ alreadySpentPaise: 0 })), 'ok')
  assert.equal(codeOf(run({ alreadySpentPaise: 80000 })), 'scope_amount_exceeded')
})

test('spending exactly to the limit is allowed', () => {
  assert.equal(codeOf(run({ alreadySpentPaise: 75000, cart: cart({ amount_paise: 25000 }) })), 'ok')
})

test('use count is enforced when the intent caps it', () => {
  assert.equal(codeOf(run({ intent: intent({ max_uses: 2 }), alreadyUsed: 1 })), 'ok')
  assert.equal(codeOf(run({ intent: intent({ max_uses: 2 }), alreadyUsed: 2 })), 'scope_uses_exhausted')
})

test('categories outside the grant are refused', () => {
  const scoped = intent({ categories: ['grocery'] })
  assert.equal(codeOf(run({ intent: scoped, categories: ['grocery'] })), 'ok')
  assert.equal(codeOf(run({ intent: scoped, categories: ['grocery', 'kitchen'] })), 'scope_category')
})

test('a null category list authorises the whole catalogue', () => {
  assert.equal(codeOf(run({ categories: ['grocery', 'kitchen', 'snacks'] })), 'ok')
})

test('a cart referencing a different intent is refused', () => {
  assert.equal(codeOf(run({ cart: cart({ intent_jti: 'mdt_other' }) })), 'mandate_chain_mismatch')
})

test('a cart for a different agent or subject is refused', () => {
  assert.equal(codeOf(run({ cart: cart({ agent: 'agent_other' }) })), 'mandate_agent_mismatch')
  assert.equal(codeOf(run({ cart: cart({ sub: 'user_other' }) })), 'mandate_subject_mismatch')
})

test('a currency mismatch is refused', () => {
  assert.equal(codeOf(run({ cart: cart({ currency: 'USD' }) })), 'scope_currency')
})
