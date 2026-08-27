import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const merchant = await import('../lib/merchant.ts')
const human = await import('../lib/human.ts')
const store = await import('../lib/session/store.ts')
const quotes = await import('../lib/quote.ts')
const payments = await import('../lib/pay/store.ts')
const { append } = await import('../lib/audit.ts')
const { authorize } = await import('../lib/gate.ts')
const { issueCart, issueIntent } = await import('../lib/mandate/issue.ts')
const { cartHash } = await import('../lib/catalog.ts')
const { StubExecutor } = await import('../lib/pay/executor.ts')

after(async () => ctx.cleanup())

const AGENT = 'agent_demo_buyer'

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES ('sku_tea', 'Tea', '', 'grocery', 10000, 'INR', 100, ?)`,
  )
  .run(nowIso())

/** One order of `quantity` units bought by an agent, paid through the gate. */
async function agentOrder(quantity: number) {
  const items = store.resolveItems([{ product_id: 'sku_tea', quantity }])
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  const quote = quotes.issue(created)
  const session = store.update(created.id, created.version, { quoteId: quote.id })

  const intent = issueIntent({ subject: 'user_demo', agent: AGENT, scope: { max_amount_paise: 10_000_000 } })
  const cart = issueCart({
    subject: 'user_demo',
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
    `idem_${session.id}`,
  )
}

async function humanOrder(quantity: number) {
  const started = human.startCheckout([{ product_id: 'sku_tea', quantity }], ADDRESS)
  human.quote(started.session.id, started.claimToken)
  return human.pay(started.session.id, started.claimToken)
}

test('an empty merchant reports zero rather than dividing by it', () => {
  const s = merchant.stats()
  assert.equal(s.revenue_paise, 0)
  assert.equal(s.orders, 0)
  assert.equal(s.average_order_paise, 0)
  assert.equal(s.agent_share_bps, 0)
})

test('revenue and the channel split follow the buyer', async () => {
  await humanOrder(1)
  await agentOrder(3)

  const s = merchant.stats()

  // 1 unit: 10000 + 4000 shipping + 500 GST = 14500
  // 3 units: 30000 + 4000 shipping + 1500 GST = 35500
  assert.equal(s.human.revenue_paise, 14500)
  assert.equal(s.human.orders, 1)
  assert.equal(s.agent.revenue_paise, 35500)
  assert.equal(s.agent.orders, 1)

  assert.equal(s.revenue_paise, 50000)
  assert.equal(s.orders, 2)
  assert.equal(s.average_order_paise, 25000)
  assert.equal(s.agent_share_bps, 7100)
})

test('only captured payments count as revenue', async () => {
  const before = merchant.stats().revenue_paise

  // A reserved but unsettled payment is not money.
  const items = store.resolveItems([{ product_id: 'sku_tea', quantity: 5 }])
  const session = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  payments.reserve(session.id, 99999, 'INR')

  assert.equal(merchant.stats().revenue_paise, before)

  payments.settle(payments.forSession(session.id)[0].id, 'failed')
  assert.equal(merchant.stats().revenue_paise, before)
})

test('best sellers rank by revenue and count units across orders', async () => {
  const s = merchant.stats()
  const tea = s.top_products.find((p) => p.product_id === 'sku_tea')

  assert.ok(tea)
  assert.equal(tea.units, 4)
  assert.equal(tea.revenue_paise, 40000)
  assert.equal(tea.title, 'Tea')
})

test('refusals are counted and grouped by reason', () => {
  append({ actor: AGENT, action: 'gate.evaluate', decision: 'refuse', reason: 'scope_amount_exceeded' })
  append({ actor: AGENT, action: 'gate.evaluate', decision: 'refuse', reason: 'scope_amount_exceeded' })
  append({ actor: AGENT, action: 'gate.evaluate', decision: 'refuse', reason: 'quote_expired' })

  const s = merchant.stats()
  const top = s.refusals_by_reason.find((r) => r.reason === 'scope_amount_exceeded')

  assert.ok(top)
  assert.equal(top.count, 2)
  assert.ok(s.refusals >= 3)
})

test('stats cross the server boundary as plain objects', () => {
  const s = merchant.stats()

  // node:sqlite hands back null-prototype rows, which React will not serialise
  // into a client component. Everything leaving here must be a plain object.
  for (const row of [...s.refusals_by_reason, ...s.top_products, ...s.recent]) {
    assert.equal(Object.getPrototypeOf(row), Object.prototype)
  }
})
