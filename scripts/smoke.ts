import { randomUUID } from 'node:crypto'
import { ADDRESS, AgentClient } from '../harness/client.ts'
import { cartHash, setPrice } from '../lib/catalog.ts'
import { gateAllowed } from '../lib/http.ts'
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

const quote = await client.post(`/api/checkout_sessions/${id}/quote`, {})
check('quote issued', quote.status === 201, quote.json)
check('quote carries a deadline', typeof quote.json?.expires_at === 'string')
// Against the catalog's own `price_ttl_seconds`, not a copy of it: a quote that
// outlived the window the merchant published is a broken promise, whatever the number is.
check(
  'quote expires within the advertised ttl',
  quote.json?.expires_in_seconds <= catalog.json?.price_ttl_seconds,
  { quoted: quote.json?.expires_in_seconds, advertised: catalog.json?.price_ttl_seconds },
)

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
  quoteId: quote.json.id,
  cartHash: cartHash(items),
  amountPaise: addressed.json.totals.total_paise,
})

const paid = await client.post(`/api/checkout_sessions/${id}/complete`, {
  intent_mandate: intent.jws,
  cart_mandate: cart.jws,
})
check('gate authorized the charge', gateAllowed(paid.status), paid.json)

// With the stub executor the capture is observed inline and the session
// completes. Against real Razorpay keys nothing is captured here — the order is
// only an instruction — so the session correctly waits at `pending_payment`
// for the signed webhook.
const expectedStatus = paid.status === 200 ? 'completed' : 'pending_payment'
check(`session ${expectedStatus}`, paid.json?.status === expectedStatus, paid.json?.status)
check('payment reference returned', typeof paid.json?.payment?.reference === 'string')
check('all gate checks passed', paid.json?.checks?.every((c: any) => c.passed) === true)

console.log('gate: the cart changes after approval')
const swapSession = await client.post('/api/checkout_sessions', {
  items: [{ product_id: 'sku_chai_250', quantity: 1 }],
  fulfillment: ADDRESS,
})
const swapId = swapSession.json.id
const swapQuote = await client.post(`/api/checkout_sessions/${swapId}/quote`, {})
const swapIntent = issueIntent({ subject: 'user_demo', agent: client.agentId, scope: { max_amount_paise: 100000 } })
const swapCart = issueCart({
  subject: 'user_demo',
  agent: client.agentId,
  intentJti: swapIntent.payload.jti,
  sessionId: swapId,
  quoteId: swapQuote.json.id,
  cartHash: cartHash([{ product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }]),
  amountPaise: swapSession.json.totals.total_paise,
})

// The agent quietly enlarges the cart after the human approved it.
await client.post(`/api/checkout_sessions/${swapId}`, { items: [{ product_id: 'sku_chai_250', quantity: 9 }] })
const swapped = await client.post(`/api/checkout_sessions/${swapId}/complete`, {
  intent_mandate: swapIntent.jws,
  cart_mandate: swapCart.jws,
})
// Two independent barriers stop this. Mutating a session invalidates its quote,
// so `quote_superseded` fires first over HTTP; the cart-hash check behind it is
// exercised directly in tests/gate.test.ts.
check('cart swap refused', swapped.json?.error?.code === 'quote_superseded', swapped.json?.error)
check('refusal lists the failed check', swapped.json?.checks?.some((c: any) => c.name === 'quote_current' && !c.passed) === true)

console.log('gate: the price moves after approval')
const driftSession = await client.post('/api/checkout_sessions', {
  items: [{ product_id: 'sku_honey_500', quantity: 1 }],
  fulfillment: ADDRESS,
})
const driftId = driftSession.json.id
const driftQuote = await client.post(`/api/checkout_sessions/${driftId}/quote`, {})
const driftIntent = issueIntent({ subject: 'user_demo', agent: client.agentId, scope: { max_amount_paise: 500000 } })
const driftCart = issueCart({
  subject: 'user_demo',
  agent: client.agentId,
  intentJti: driftIntent.payload.jti,
  sessionId: driftId,
  quoteId: driftQuote.json.id,
  cartHash: cartHash([{ product_id: 'sku_honey_500', quantity: 1, unit_price_paise: 47500 }]),
  amountPaise: driftSession.json.totals.total_paise,
})

// The merchant reprices while the human is still deciding.
setPrice('sku_honey_500', 52500)

const drifted = await client.post(`/api/checkout_sessions/${driftId}/complete`, {
  intent_mandate: driftIntent.jws,
  cart_mandate: driftCart.jws,
})
check('price drift refused', drifted.json?.error?.code === 'quote_price_drift', drifted.json?.error)
check('the cart itself was unchanged', drifted.json?.checks?.some((c: any) => c.name === 'cart_unchanged' && c.passed) === true)
setPrice('sku_honey_500', 47500)

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
