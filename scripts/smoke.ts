import { randomUUID } from 'node:crypto'
import { ADDRESS, AgentClient } from '../harness/client.ts'
import { cartHash } from '../lib/catalog.ts'
import { issueCart, issueIntent } from '../lib/mandate/issue.ts'

const client = new AgentClient()
let failures = 0

function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  const suffix = ok || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${suffix}`)
}

console.log('discovery and catalog')
const manifest = await client.get('/.well-known/agent-commerce')
check('manifest served', manifest.status === 200)
check('declares acp-shaped checkout', manifest.json?.protocol?.checkout === 'acp-shaped/2026-08')
const catalog = await client.get('/api/catalog')
check('catalog has products', (catalog.json?.items?.length ?? 0) > 0)

console.log('authentication')
const unsigned = await fetch(`${client.base}/api/checkout_sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [] }),
})
check('unsigned request refused', unsigned.status === 400, unsigned.status)

const badSecret = await client.post('/api/checkout_sessions', { items: [] }, { secretOverride: 'wrong' })
check('wrong secret refused', badSecret.json?.error?.code === 'invalid_signature', badSecret.json?.error)

const tampered = await client.post(
  '/api/checkout_sessions',
  { items: [{ product_id: 'sku_chai_250', quantity: 99 }] },
  { signedBodyOverride: JSON.stringify({ items: [] }) },
)
check('body tampering refused', tampered.json?.error?.code === 'invalid_signature', tampered.json?.error)

const stale = await client.post('/api/checkout_sessions', { items: [] }, { timestampOffset: -3600 })
check('stale timestamp refused', stale.json?.error?.code === 'stale_timestamp', stale.json?.error)

const noKey = await client.post('/api/checkout_sessions', { items: [] }, { omit: ['Idempotency-Key'] })
check('missing Idempotency-Key refused', noKey.json?.error?.code === 'missing_header', noKey.json?.error)

const unknownAgent = await new AgentClient({ agentId: 'agent_ghost' }).post('/api/checkout_sessions', { items: [] })
check('unknown agent refused', unknownAgent.json?.error?.code === 'unknown_agent', unknownAgent.json?.error)

console.log('session lifecycle')
const created = await client.post('/api/checkout_sessions', {
  items: [{ product_id: 'sku_chai_250', quantity: 2, unit_price_paise: 1 }],
})
check('created', created.status === 201, created.json)
const id: string = created.json?.id
check('not payable without an address', created.json?.status === 'not_ready_for_payment')
check('spoofed price ignored', created.json?.line_items?.[0]?.unit_price_paise === 24900)
check('totals computed server-side', created.json?.totals?.items_paise === 49800, created.json?.totals)

const addressed = await client.post(`/api/checkout_sessions/${id}`, { fulfillment: ADDRESS })
check('now payable', addressed.json?.status === 'ready_for_payment', addressed.json?.status)
check('version advanced', addressed.json?.version === 1)

console.log('idempotency')
const key = randomUUID()
const first = await client.post('/api/checkout_sessions', { items: [{ product_id: 'sku_chai_250', quantity: 1 }] }, { idempotencyKey: key })
const replay = await client.post('/api/checkout_sessions', { items: [{ product_id: 'sku_chai_250', quantity: 1 }] }, { idempotencyKey: key })
check('replay returns the original session', replay.json?.id === first.json?.id, { first: first.json?.id, replay: replay.json?.id })
check('replay is flagged', replay.headers.get('Idempotent-Replay') === 'true')

const reused = await client.post('/api/checkout_sessions', { items: [{ product_id: 'sku_honey_500', quantity: 1 }] }, { idempotencyKey: key })
check('key reuse with a different body refused', reused.json?.error?.code === 'idempotency_key_reuse', reused.json?.error)

console.log('completion requires mandates')
const bare = await client.post(`/api/checkout_sessions/${id}/complete`, {})
check('refused without mandates', bare.json?.error?.code === 'mandate_required', bare.json?.error)

console.log('gate: a well-formed purchase')
// The wallet, not the merchant, issues mandates. The harness plays that role.
const items = created.json.line_items.map((l: any) => ({
  product_id: l.product_id,
  quantity: l.quantity,
  unit_price_paise: l.unit_price_paise,
}))

const intent = issueIntent({
  subject: 'user_demo',
  agent: client.agentId,
  scope: { max_amount_paise: 100000 },
})

const cart = issueCart({
  subject: 'user_demo',
  agent: client.agentId,
  intentJti: intent.payload.jti,
  sessionId: id,
  cartHash: cartHash(items),
  amountPaise: addressed.json.totals.total_paise,
})

const paid = await client.post(`/api/checkout_sessions/${id}/complete`, {
  intent_mandate: intent.jws,
  cart_mandate: cart.jws,
})
check('authorized and captured', paid.status === 200, paid.json)
check('session completed', paid.json?.status === 'completed', paid.json?.status)
check('payment reference returned', typeof paid.json?.payment?.reference === 'string')
check('all gate checks passed', paid.json?.checks?.every((c: any) => c.passed) === true)

console.log('gate: the cart changes after approval')
const swapSession = await client.post('/api/checkout_sessions', {
  items: [{ product_id: 'sku_chai_250', quantity: 1 }],
  fulfillment: ADDRESS,
})
const swapId = swapSession.json.id
const swapIntent = issueIntent({ subject: 'user_demo', agent: client.agentId, scope: { max_amount_paise: 100000 } })
const swapCart = issueCart({
  subject: 'user_demo',
  agent: client.agentId,
  intentJti: swapIntent.payload.jti,
  sessionId: swapId,
  cartHash: cartHash([{ product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }]),
  amountPaise: swapSession.json.totals.total_paise,
})

// The agent quietly enlarges the cart after the human approved it.
await client.post(`/api/checkout_sessions/${swapId}`, { items: [{ product_id: 'sku_chai_250', quantity: 9 }] })
const swapped = await client.post(`/api/checkout_sessions/${swapId}/complete`, {
  intent_mandate: swapIntent.jws,
  cart_mandate: swapCart.jws,
})
check('cart swap refused', swapped.json?.error?.code === 'cart_hash_mismatch', swapped.json?.error)
check('refusal lists the failed check', swapped.json?.checks?.some((c: any) => c.name === 'cart_unchanged' && !c.passed) === true)

console.log('terminal states')
const doomed = await client.post('/api/checkout_sessions', {
  items: [{ product_id: 'sku_biscuit_pack', quantity: 1 }],
})
const doomedId = doomed.json.id

const canceled = await client.post(`/api/checkout_sessions/${doomedId}/cancel`, {})
check('canceled', canceled.json?.status === 'canceled', canceled.json?.status)
const again = await client.post(`/api/checkout_sessions/${doomedId}/cancel`, {})
check('second cancel refused', again.json?.error?.code === 'session_terminal', again.json?.error)
const mutate = await client.post(`/api/checkout_sessions/${doomedId}`, { items: [{ product_id: 'sku_chai_250', quantity: 1 }] })
check('terminal session immutable', mutate.status === 409, mutate.status)

const paidAgain = await client.post(`/api/checkout_sessions/${id}/complete`, {
  intent_mandate: intent.jws,
  cart_mandate: cart.jws,
})
check('a completed session cannot be paid twice', paidAgain.json?.error?.code === 'session_not_payable', paidAgain.json?.error)

console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
