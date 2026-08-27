import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADDRESS, freshDb } from './helpers.ts'
import type { ApprovalRow } from '../lib/wallet.ts'

const ctx = freshDb()

const { db, nowIso } = await import('../lib/db/client.ts')
const quotes = await import('../lib/quote.ts')
const store = await import('../lib/session/store.ts')
const wallet = await import('../lib/wallet.ts')
const { evaluate, authorize } = await import('../lib/gate.ts')
const { StubExecutor } = await import('../lib/pay/executor.ts')
const { ApiError } = await import('../lib/http.ts')

after(async () => ctx.cleanup())

const AGENT = 'agent_demo_buyer'

db()
  .prepare(
    `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
     VALUES ('sku_tumbler', 'Steel Chai Tumbler', '', 'kitchen', 39900, 'INR', 50, ?)`,
  )
  .run(nowIso())

/** A session carried all the way to a granted approval. */
function granted(quantity = 1) {
  const items = store.resolveItems([{ product_id: 'sku_tumbler', quantity }])
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  const quote = quotes.issue(created)
  store.update(created.id, created.version, { quoteId: quote.id })

  const request = wallet.request(created.id, AGENT)
  return wallet.approve(request.id)
}

const gateRequest = (a: ApprovalRow) => ({
  sessionId: a.session_id,
  callerAgentId: AGENT,
  intentJws: a.intent_jws as string,
  cartJws: a.cart_jws as string,
})

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    return err instanceof ApiError ? err.code : 'not_api_error'
  }
  return 'no_error'
}

test('a granted approval is spendable until it is revoked', () => {
  const approval = granted()
  assert.equal(evaluate(gateRequest(approval)).allow, true)
})

test('revoking consent makes the gate refuse it', () => {
  const approval = granted()
  const revoked = wallet.revoke(approval.id)

  assert.ok(revoked.revoked_at)
  const decision = evaluate(gateRequest(approval))
  assert.equal(decision.allow, false)
  assert.equal(decision.code, 'mandate_already_used')
})

test('revocation is enforced by the mandate, not only by the approval row', () => {
  const approval = granted()
  wallet.revoke(approval.id)

  // Even with the approval row forced back to a clean state, the consumed
  // mandate still refuses. The record is a display; the mandate is the control.
  db().prepare('UPDATE approvals SET revoked_at = NULL WHERE id = ?').run(approval.id)
  assert.equal(evaluate(gateRequest(approval)).code, 'mandate_already_used')
})

test('an approval cannot be revoked twice', () => {
  const approval = granted()
  wallet.revoke(approval.id)
  assert.equal(codeOf(() => wallet.revoke(approval.id)), 'approval_revoked')
})

test('a pending approval cannot be revoked, only denied', () => {
  const items = store.resolveItems([{ product_id: 'sku_tumbler', quantity: 1 }])
  const created = store.create({ agentId: AGENT, items, fulfillment: ADDRESS })
  const quote = quotes.issue(created)
  store.update(created.id, created.version, { quoteId: quote.id })
  const request = wallet.request(created.id, AGENT)

  assert.equal(codeOf(() => wallet.revoke(request.id)), 'approval_not_approved')
  assert.equal(wallet.deny(request.id).status, 'denied')
})

test('a spent approval cannot be revoked after the fact', async () => {
  const approval = granted()
  const result = await authorize(gateRequest(approval), new StubExecutor(), 'idem_spend')
  assert.equal(result.status, 200)

  assert.equal(codeOf(() => wallet.revoke(approval.id)), 'approval_spent')
})

test('outstanding lists live authority and drops it once revoked or spent', async () => {
  db().prepare('DELETE FROM approvals').run()

  const keep = granted()
  const drop = granted()
  assert.equal(wallet.outstanding().length, 2)

  wallet.revoke(drop.id)
  assert.deepEqual(wallet.outstanding().map((a) => a.id), [keep.id])

  await authorize(gateRequest(keep), new StubExecutor(), 'idem_keep')
  assert.equal(wallet.outstanding().length, 0)
})
