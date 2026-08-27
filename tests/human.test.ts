import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const { registerAgent } = await import('../lib/agents.ts')
const human = await import('../lib/human.ts')
const store = await import('../lib/session/store.ts')
const quotes = await import('../lib/quote.ts')
const catalog = await import('../lib/catalog.ts')
const { evaluate } = await import('../lib/gate.ts')
const { issueCart, issueIntent } = await import('../lib/mandate/issue.ts')
const { ApiError } = await import('../lib/http.ts')

after(async () => ctx.cleanup())

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES ('sku_ghee', 'Ghee', '', 'grocery', 89900, 'INR', 20, ?)`,
  )
  .run(nowIso())

const AGENT = 'agent_demo_buyer'
const ITEMS = [{ product_id: 'sku_ghee', quantity: 1 }]

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    return err instanceof ApiError ? err.code : 'not_api_error'
  }
  return 'no_error'
}

/** A browser checkout carried to the point of payment. */
function readyToPay() {
  const started = human.startCheckout(ITEMS, ADDRESS)
  human.quote(started.session.id, started.claimToken)
  return started
}

test('a browser checkout is stamped with the reserved web identity', () => {
  const { session, claimToken } = human.startCheckout(ITEMS, ADDRESS)
  assert.equal(session.agentId, human.WEB_BUYER)
  assert.equal(typeof claimToken, 'string')
  assert.ok(claimToken.length > 20)
})

test('the reserved identity can never be given credentials', () => {
  assert.throws(() => registerAgent(human.WEB_BUYER, 'Impostor', 'secret'), /reserved identity/)
})

test('a different browser cannot act on the checkout', () => {
  const { session } = human.startCheckout(ITEMS, ADDRESS)
  assert.equal(codeOf(() => human.quote(session.id, 'some-other-token')), 'claim_invalid')
})

test('paying runs the full gate and completes the session', async () => {
  const { session, claimToken } = readyToPay()
  const result = await human.pay(session.id, claimToken)

  assert.equal(result.status, 200)
  assert.equal(result.decision.allow, true)
  assert.equal(result.decision.checks.length, 12)
  assert.ok(result.decision.checks.every((c) => c.passed))
  assert.equal(store.get(session.id).status, 'completed')
})

test('a browser purchase leaves the same audit shape as an agent purchase', async () => {
  const { session, claimToken } = readyToPay()
  await human.pay(session.id, claimToken)

  const { forSession } = await import('../lib/audit.ts')
  const trail = forSession(session.id)

  assert.ok(trail.some((e) => e.action === 'gate.evaluate' && e.decision === 'allow'))
  assert.ok(trail.some((e) => e.action === 'payment.capture' && e.decision === 'allow'))
  assert.ok(trail.every((e) => e.actor === human.WEB_BUYER))
})

test('an agent cannot pay for a checkout it does not own', async () => {
  const items = store.resolveItems(ITEMS)
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  const quote = quotes.issue(created)
  store.update(created.id, created.version, { quoteId: quote.id })

  await assert.rejects(
    () => human.pay(created.id, 'anything'),
    (err: unknown) => err instanceof ApiError && err.code === 'not_a_web_checkout',
  )
})

test('an agent mandate against a browser checkout is refused by the gate', () => {
  const { session, claimToken } = readyToPay()
  const quoteId = store.get(session.id).quoteId as string

  // The agent obtains genuinely signed mandates naming itself, for a cart that
  // belongs to the browser.
  const intent = issueIntent({ subject: 'user_demo', agent: AGENT, scope: { max_amount_paise: 10_000_000 } })
  const cart = issueCart({
    subject: 'user_demo',
    agent: AGENT,
    intentJti: intent.payload.jti,
    sessionId: session.id,
    quoteId,
    cartHash: catalog.cartHash(store.get(session.id).items),
    amountPaise: store.get(session.id).totals.total_paise,
  })

  const decision = evaluate({
    sessionId: session.id,
    callerAgentId: AGENT,
    intentJws: intent.jws,
    cartJws: cart.jws,
  })

  assert.equal(decision.allow, false)
  assert.equal(decision.code, 'mandate_wrong_buyer')
  void claimToken
})

test('a checkout cannot be paid twice through the browser', async () => {
  const { session, claimToken } = readyToPay()
  assert.equal((await human.pay(session.id, claimToken)).status, 200)

  await assert.rejects(
    () => human.pay(session.id, claimToken),
    (err: unknown) => err instanceof ApiError && err.code === 'session_not_payable',
  )
})

test('an expired quote blocks payment until the price is refreshed', async () => {
  const { session, claimToken } = readyToPay()
  const quoteId = store.get(session.id).quoteId as string

  db()
    .prepare('UPDATE quotes SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), quoteId)

  await assert.rejects(
    () => human.pay(session.id, claimToken),
    (err: unknown) => err instanceof ApiError && err.code === 'quote_expired',
  )

  human.quote(session.id, claimToken)
  assert.equal((await human.pay(session.id, claimToken)).status, 200)
})
