import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const store = await import('../lib/session/store.ts')
const { ApiError } = await import('../lib/http.ts')

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES (?, ?, '', 'grocery', ?, 'INR', ?, ?)`,
  )
  .run('sku_chai_250', 'Assam CTC Chai 250g', 24900, 40, nowIso())

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES (?, ?, '', 'grocery', ?, 'INR', ?, ?)`,
  )
  .run('sku_scarce', 'Scarce Item', 1000, 2, nowIso())

after(async () => ctx.cleanup())

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    return err instanceof ApiError ? err.code : 'not_api_error'
  }
  return 'no_error'
}

test('a caller-supplied price is ignored in favour of the catalog', () => {
  const items = store.resolveItems([
    { product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 1 },
  ])
  assert.equal(items[0].unit_price_paise, 24900)
})

test('duplicate lines for one product are merged', () => {
  const items = store.resolveItems([
    { product_id: 'sku_chai_250', quantity: 2 },
    { product_id: 'sku_chai_250', quantity: 3 },
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 5)
})

test('invalid items are rejected with specific codes', () => {
  assert.equal(code(() => store.resolveItems('nope')), 'invalid_items')
  assert.equal(code(() => store.resolveItems([{ product_id: 'ghost', quantity: 1 }])), 'unknown_product')
  assert.equal(code(() => store.resolveItems([{ product_id: 'sku_chai_250', quantity: 0 }])), 'invalid_quantity')
  assert.equal(code(() => store.resolveItems([{ product_id: 'sku_chai_250', quantity: 1.5 }])), 'invalid_quantity')
  assert.equal(code(() => store.resolveItems([{ product_id: 'sku_scarce', quantity: 5 }])), 'insufficient_stock')
})

test('a session with items but no address is not payable', () => {
  const session = store.create({
    agentId: 'agent_test',
    items: store.resolveItems([{ product_id: 'sku_chai_250', quantity: 1 }]),
    fulfillment: null,
  })
  assert.equal(session.status, 'not_ready_for_payment')
  assert.equal(session.version, 0)
})

test('adding an address makes the session payable', () => {
  const created = store.create({
    agentId: 'agent_test',
    items: store.resolveItems([{ product_id: 'sku_chai_250', quantity: 1 }]),
    fulfillment: null,
  })
  const updated = store.update(created.id, created.version, { fulfillment: ADDRESS })
  assert.equal(updated.status, 'ready_for_payment')
  assert.equal(updated.version, 1)
})

test('a stale version loses the write instead of overwriting it', () => {
  const created = store.create({
    agentId: 'agent_test',
    items: store.resolveItems([{ product_id: 'sku_chai_250', quantity: 1 }]),
    fulfillment: ADDRESS,
  })

  store.update(created.id, created.version, { fulfillment: { ...ADDRESS, city: 'Pune' } })

  // Second writer still holds the version it originally read.
  assert.equal(
    code(() => store.update(created.id, created.version, { fulfillment: { ...ADDRESS, city: 'Delhi' } })),
    'version_conflict',
  )
  assert.equal(store.get(created.id).fulfillment?.city, 'Pune')
})

test('a canceled session refuses further modification', () => {
  const created = store.create({
    agentId: 'agent_test',
    items: store.resolveItems([{ product_id: 'sku_chai_250', quantity: 1 }]),
    fulfillment: ADDRESS,
  })
  const canceled = store.update(created.id, created.version, { status: 'canceled' })
  assert.equal(canceled.status, 'canceled')
  assert.equal(
    code(() => store.update(created.id, canceled.version, { fulfillment: ADDRESS })),
    'session_terminal',
  )
})
