import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const catalog = await import('../lib/catalog.ts')
const quotes = await import('../lib/quote.ts')
const store = await import('../lib/session/store.ts')
const { evaluate, authorize } = await import('../lib/gate.ts')
const { issueCart, issueIntent } = await import('../lib/mandate/issue.ts')
const { StubExecutor } = await import('../lib/pay/executor.ts')

after(async () => ctx.cleanup())

const AGENT = 'agent_demo_buyer'
const SUBJECT = 'user_demo'

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES ('sku_ghee', 'Ghee', '', 'grocery', 89900, 'INR', 20, ?)`,
  )
  .run(nowIso())

/** Session, quote and mandates as they stand at the moment of human approval. */
function approved(quantity = 1) {
  const items = store.resolveItems([{ product_id: 'sku_ghee', quantity }])
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  const quote = quotes.issue(created)
  const session = store.update(created.id, created.version, { quoteId: quote.id })

  const intent = issueIntent({ subject: SUBJECT, agent: AGENT, scope: { max_amount_paise: 10_000_000 } })
  const cart = issueCart({
    subject: SUBJECT,
    agent: AGENT,
    intentJti: intent.payload.jti,
    sessionId: session.id,
    quoteId: quote.id,
    cartHash: catalog.cartHash(session.items),
    amountPaise: session.totals.total_paise,
  })

  return { session, quote, intent, cart }
}

const request = (s: ReturnType<typeof approved>) => ({
  sessionId: s.session.id,
  callerAgentId: AGENT,
  intentJws: s.intent.jws,
  cartJws: s.cart.jws,
})

const restorePrice = () => catalog.setPrice('sku_ghee', 89900)
const restoreStock = () => catalog.setStock('sku_ghee', 20)

test('a fresh quote carries a bounded lifetime', () => {
  const s = approved()
  assert.equal(quotes.isExpired(s.quote), false)
  assert.ok(quotes.secondsRemaining(s.quote) > 0)
  assert.ok(quotes.secondsRemaining(s.quote) <= 120)
})

test('a well-formed purchase passes the quote and drift checks', () => {
  const decision = evaluate(request(approved()))
  assert.equal(decision.allow, true, decision.message)
  assert.ok(decision.checks.find((c) => c.name === 'quote_current')?.passed)
  assert.ok(decision.checks.find((c) => c.name === 'price_unchanged')?.passed)
})

test('an expired quote is refused even though the mandate is still valid', () => {
  const s = approved()
  db()
    .prepare('UPDATE quotes SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), s.quote.id)

  const decision = evaluate(request(s))
  assert.equal(decision.code, 'quote_expired')
  assert.ok(decision.checks.find((c) => c.name === 'cart_mandate_valid')?.passed)
})

test('a price rise between approval and completion is refused', () => {
  const s = approved()
  catalog.setPrice('sku_ghee', 99900)

  const decision = evaluate(request(s))
  assert.equal(decision.code, 'quote_price_drift')
  restorePrice()
})

test('a price cut is refused too, because consent was given for a different transaction', () => {
  const s = approved()
  catalog.setPrice('sku_ghee', 49900)

  assert.equal(evaluate(request(s)).code, 'quote_price_drift')
  restorePrice()
})

test('stock selling out between approval and completion is refused', () => {
  const s = approved(5)
  catalog.setStock('sku_ghee', 2)

  assert.equal(evaluate(request(s)).code, 'quote_price_drift')
  restoreStock()
})

test('a withdrawn product is refused', () => {
  const s = approved()
  db().prepare("DELETE FROM products WHERE id = 'sku_ghee'").run()

  assert.equal(evaluate(request(s)).code, 'quote_price_drift')

  db()
    .prepare(
      `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
       VALUES ('sku_ghee', 'Ghee', '', 'grocery', 89900, 'INR', 20, ?)`,
    )
    .run(nowIso())
})

test('issuing a newer quote invalidates a mandate approved against the older one', () => {
  const s = approved()
  const current = store.get(s.session.id)
  const replacement = quotes.issue(current)
  store.update(current.id, current.version, { quoteId: replacement.id })

  assert.equal(evaluate(request(s)).code, 'quote_superseded')
})

test('after drift, a fresh quote and a fresh mandate complete the purchase', async () => {
  const s = approved()
  catalog.setPrice('sku_ghee', 99900)
  assert.equal(evaluate(request(s)).code, 'quote_price_drift')

  // The buyer is re-shown the new price and approves again.
  const stale = store.get(s.session.id)
  const repriced = store.update(stale.id, stale.version, {
    items: store.resolveItems([{ product_id: 'sku_ghee', quantity: 1 }]),
  })

  const quote = quotes.issue(repriced)
  const session = store.update(repriced.id, repriced.version, { quoteId: quote.id })

  const cart = issueCart({
    subject: SUBJECT,
    agent: AGENT,
    intentJti: s.intent.payload.jti,
    sessionId: session.id,
    quoteId: quote.id,
    cartHash: catalog.cartHash(session.items),
    amountPaise: session.totals.total_paise,
  })

  const result = await authorize(
    { sessionId: session.id, callerAgentId: AGENT, intentJws: s.intent.jws, cartJws: cart.jws },
    new StubExecutor(),
    'idem_requote',
  )

  assert.equal(result.status, 200)
  assert.equal(store.get(session.id).status, 'completed')
  // The buyer is charged the new price they actually approved, not the old one.
  assert.equal((result.body as { payment: { amount_paise: number } }).payment.amount_paise, 104895)
  restorePrice()
})
