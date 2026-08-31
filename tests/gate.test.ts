import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const { cartHash } = await import('../lib/catalog.ts')
const { evaluate, authorize } = await import('../lib/gate.ts')
const { issueCart, issueIntent } = await import('../lib/mandate/issue.ts')
const store = await import('../lib/session/store.ts')
const mandates = await import('../lib/mandate/store.ts')
const payments = await import('../lib/pay/store.ts')
const quotes = await import('../lib/quote.ts')
const { StubExecutor } = await import('../lib/pay/executor.ts')
import type { PaymentExecutor, PaymentResult } from '../lib/pay/executor.ts'

after(async () => ctx.cleanup())

const AGENT = 'agent_demo_buyer'
const SUBJECT = 'user_demo'

const product = (id: string, category: string, price: number) =>
  db()
    .prepare(
      `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
       VALUES (?, ?, '', ?, ?, 'INR', 100, ?)`,
    )
    .run(id, id, category, price, nowIso())

product('sku_chai', 'grocery', 20000)
product('sku_pan', 'kitchen', 50000)

const fixedExecutor = (result: PaymentResult): PaymentExecutor => ({
  name: 'fixed',
  execute: async () => result,
})

const failing = fixedExecutor({
  outcome: 'failed',
  captured: false,
  reference: null,
  providerOrderId: 'order_x',
  message: 'issuer declined',
})

const indeterminate = fixedExecutor({
  outcome: 'unknown',
  captured: false,
  reference: null,
  providerOrderId: null,
  message: 'gateway timed out',
})

/** A provider that accepts the instruction but confirms no capture. */
const uncaptured = fixedExecutor({
  outcome: 'succeeded',
  captured: false,
  reference: 'plink_x',
  providerOrderId: 'order_y',
  message: 'payment link created',
})

/** Builds a payable session plus a matching intent and cart mandate. */
function scenario(
  opts: {
    items?: Array<{ product_id: string; quantity: number }>
    maxAmountPaise?: number
    categories?: string[] | null
    maxUses?: number | null
    cartTtl?: number
  } = {},
) {
  const items = store.resolveItems(opts.items ?? [{ product_id: 'sku_chai', quantity: 1 }])
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })

  const quote = quotes.issue(created)
  const session = store.update(created.id, created.version, { quoteId: quote.id })

  const intent = issueIntent({
    subject: SUBJECT,
    agent: AGENT,
    scope: {
      max_amount_paise: opts.maxAmountPaise ?? 1_000_000,
      categories: opts.categories ?? null,
      max_uses: opts.maxUses ?? null,
    },
  })

  const cart = issueCart({
    subject: SUBJECT,
    agent: AGENT,
    intentJti: intent.payload.jti,
    sessionId: session.id,
    quoteId: quote.id,
    cartHash: cartHash(session.items),
    amountPaise: session.totals.total_paise,
    ttlSeconds: opts.cartTtl,
  })

  return { session, intent, cart, quote }
}

const request = (s: ReturnType<typeof scenario>, overrides: Record<string, unknown> = {}) => ({
  sessionId: s.session.id,
  callerAgentId: AGENT,
  intentJws: s.intent.jws,
  cartJws: s.cart.jws,
  ...overrides,
})

const key = () => `idem_${Math.random().toString(36).slice(2)}`

test('a well-formed purchase is authorized and every check passes', async () => {
  const s = scenario()
  const decision = evaluate(request(s))

  assert.equal(decision.allow, true, decision.message)
  assert.ok(decision.checks.every((c) => c.passed))
  assert.deepEqual(
    decision.checks.map((c) => c.name),
    [
      'session_exists',
      'session_payable',
      'no_live_payment',
      'intent_mandate_valid',
      'cart_mandate_valid',
      'agent_matches_caller',
      'cart_bound_to_session',
      'quote_current',
      'cart_unchanged',
      'price_unchanged',
      'amount_matches_total',
      'within_intent_scope',
    ],
  )
})

test('authorizing captures payment, completes the session and consumes the mandate', async () => {
  const s = scenario()
  const result = await authorize(request(s), new StubExecutor(), key())

  assert.equal(result.status, 200)
  assert.equal(store.get(s.session.id).status, 'completed')
  assert.ok(mandates.byJti(s.cart.payload.jti)?.consumed_at)
  assert.equal(payments.forSession(s.session.id)[0].status, 'captured')
})

test('changing the cart after approval is refused', () => {
  const s = scenario()
  const current = store.get(s.session.id)

  store.update(current.id, current.version, {
    items: store.resolveItems([{ product_id: 'sku_chai', quantity: 5 }]),
  })

  const decision = evaluate(request(s))
  assert.equal(decision.allow, false)
  assert.equal(decision.code, 'cart_hash_mismatch')
})

test('a mandate approving a different amount is refused', () => {
  const s = scenario()
  const understated = issueCart({
    subject: SUBJECT,
    agent: AGENT,
    intentJti: s.intent.payload.jti,
    sessionId: s.session.id,
    quoteId: s.quote.id,
    cartHash: cartHash(s.session.items),
    amountPaise: 1,
  })

  const decision = evaluate(request(s, { cartJws: understated.jws }))
  assert.equal(decision.code, 'amount_mismatch')
})

test('a mandate issued for another session is refused', () => {
  const a = scenario()
  const b = scenario()
  assert.equal(evaluate(request(a, { cartJws: b.cart.jws })).code, 'mandate_wrong_session')
})

test('a caller who is not the mandated agent is refused', () => {
  const s = scenario()
  assert.equal(evaluate(request(s, { callerAgentId: 'agent_impostor' })).code, 'mandate_agent_mismatch')
})

test('a cart beyond the intent limit is refused', () => {
  const s = scenario({ maxAmountPaise: 1000 })
  assert.equal(evaluate(request(s)).code, 'scope_amount_exceeded')
})

test('a category outside the grant is refused', () => {
  const s = scenario({ items: [{ product_id: 'sku_pan', quantity: 1 }], categories: ['grocery'] })
  assert.equal(evaluate(request(s)).code, 'scope_category')
})

test('an expired cart mandate is refused', () => {
  const s = scenario({ cartTtl: -5 })
  assert.equal(evaluate(request(s)).code, 'mandate_expired')
})

test('a consumed mandate cannot be presented again', () => {
  const s = scenario()
  assert.equal(mandates.consume(s.cart.payload.jti), true)
  assert.equal(evaluate(request(s)).code, 'mandate_already_used')
})

test('a paid session is refused at the session check, before any mandate work', async () => {
  const s = scenario()
  await authorize(request(s), new StubExecutor(), key())

  const second = await authorize(request(s), new StubExecutor(), key())
  assert.equal(second.status, 409)
  assert.equal(second.decision.code, 'session_not_payable')

  // Cheap checks run first: no signature verification happens on a dead session.
  assert.deepEqual(
    second.decision.checks.map((c) => c.name),
    ['session_exists', 'session_payable'],
  )
  assert.equal(payments.forSession(s.session.id).length, 1)
})

test('a session that is not payable is refused', () => {
  const s = scenario()
  const current = store.get(s.session.id)
  store.update(current.id, current.version, { status: 'canceled' })

  assert.equal(evaluate(request(s)).code, 'session_not_payable')
})

test('a definitively failed payment releases the mandate and leaves the session payable', async () => {
  const s = scenario()
  const result = await authorize(request(s), failing, key())

  assert.equal(result.status, 402)
  assert.equal(mandates.byJti(s.cart.payload.jti)?.consumed_at, null)
  assert.equal(store.get(s.session.id).status, 'ready_for_payment')
  assert.equal(payments.forSession(s.session.id)[0].status, 'failed')
})

test('a released mandate can be retried and then succeeds', async () => {
  const s = scenario()
  await authorize(request(s), failing, key())

  const retry = await authorize(request(s), new StubExecutor(), key())
  assert.equal(retry.status, 200)
  assert.equal(store.get(s.session.id).status, 'completed')
})

test('an indeterminate payment holds the mandate and the session for reconciliation', async () => {
  const s = scenario()
  const result = await authorize(request(s), indeterminate, key())

  assert.equal(result.status, 409)
  assert.ok(mandates.byJti(s.cart.payload.jti)?.consumed_at, 'mandate must stay consumed')
  assert.equal(payments.forSession(s.session.id)[0].status, 'pending')
  assert.equal(store.get(s.session.id).status, 'pending_payment')

  // A session held for reconciliation is not payable again.
  assert.equal(evaluate(request(s)).code, 'session_not_payable')
})

test('an accepted but uncaptured payment leaves the session pending, not completed', async () => {
  const s = scenario()
  const result = await authorize(request(s), uncaptured, key())

  assert.equal(result.status, 202)
  assert.equal(store.get(s.session.id).status, 'pending_payment')
  assert.equal(payments.forSession(s.session.id)[0].status, 'authorized')

  // The mandate is spent: the instruction is out with the provider.
  assert.ok(mandates.byJti(s.cart.payload.jti)?.consumed_at)

  // And nothing can charge the session a second time while capture is open.
  assert.equal(evaluate(request(s)).code, 'session_not_payable')
})

test('a pending session refuses cart edits', async () => {
  const s = scenario()
  await authorize(request(s), uncaptured, key())

  const current = store.get(s.session.id)
  assert.throws(
    () =>
      store.update(current.id, current.version, {
        items: store.resolveItems([{ product_id: 'sku_chai', quantity: 2 }]),
      }),
    /session_locked|pending_payment/,
  )
})

test('drawdown accumulates across purchases on one intent', async () => {
  const items = store.resolveItems([{ product_id: 'sku_chai', quantity: 1 }])
  const intent = issueIntent({
    subject: SUBJECT,
    agent: AGENT,
    scope: { max_amount_paise: 50000 },
  })

  const buy = async () => {
    const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
    const quote = quotes.issue(created)
    const session = store.update(created.id, created.version, { quoteId: quote.id })

    const cart = issueCart({
      subject: SUBJECT,
      agent: AGENT,
      intentJti: intent.payload.jti,
      sessionId: session.id,
      quoteId: quote.id,
      cartHash: cartHash(session.items),
      amountPaise: session.totals.total_paise,
    })
    return authorize(
      { sessionId: session.id, callerAgentId: AGENT, intentJws: intent.jws, cartJws: cart.jws },
      new StubExecutor(),
      key(),
    )
  }

  // Each order totals 25000 paise: 20000 items + 4000 shipping + 1000 GST.
  assert.equal((await buy()).status, 200)
  assert.equal(mandates.drawdown(intent.payload.jti), 25000)

  assert.equal((await buy()).status, 200)
  assert.equal(mandates.drawdown(intent.payload.jti), 50000)

  const third = await buy()
  assert.equal(third.status, 409)
  assert.equal(third.decision.code, 'scope_amount_exceeded')
})
