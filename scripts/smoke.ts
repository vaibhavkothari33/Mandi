const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT = 'agent_smoke'

let failures = 0

function check(label: string, condition: boolean, detail?: unknown) {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures++
  console.log(`  [${mark}] ${label}${condition || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Agent-Id': AGENT },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

const ADDRESS = {
  name: 'A Buyer',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  postal_code: '560025',
  country: 'IN',
}

console.log('discovery')
const manifest = await call('GET', '/.well-known/agent-commerce')
check('manifest served', manifest.status === 200, manifest.json)
check('declares acp-shaped checkout', manifest.json?.protocol?.checkout === 'acp-shaped/2026-08')

console.log('catalog')
const catalog = await call('GET', '/api/catalog')
check('catalog served', catalog.status === 200)
check('has products', (catalog.json?.items?.length ?? 0) > 0, catalog.json?.items?.length)

console.log('create session with a spoofed unit price')
const created = await call('POST', '/api/checkout_sessions', {
  items: [{ product_id: 'sku_chai_250', quantity: 2, unit_price_paise: 1 }],
})
check('created', created.status === 201, created.json)
const id: string = created.json?.id
check('not payable without an address', created.json?.status === 'not_ready_for_payment', created.json?.status)
check('spoofed price ignored', created.json?.line_items?.[0]?.unit_price_paise === 24900, created.json?.line_items?.[0])
check('totals computed server-side', created.json?.totals?.items_paise === 49800, created.json?.totals)

console.log('add fulfillment')
const addressed = await call('POST', `/api/checkout_sessions/${id}`, { fulfillment: ADDRESS })
check('now payable', addressed.json?.status === 'ready_for_payment', addressed.json?.status)
check('version advanced', addressed.json?.version === 1, addressed.json?.version)

console.log('read back')
const fetched = await call('GET', `/api/checkout_sessions/${id}`)
check('readable', fetched.status === 200 && fetched.json?.id === id)

console.log('completion is gated')
const completed = await call('POST', `/api/checkout_sessions/${id}/complete`)
check('refused with 501', completed.status === 501, completed.json)
check('names the missing gate', completed.json?.error?.code === 'gate_not_implemented', completed.json?.error)

console.log('unknown product')
const bad = await call('POST', '/api/checkout_sessions', { items: [{ product_id: 'ghost', quantity: 1 }] })
check('rejected', bad.status === 404 && bad.json?.error?.code === 'unknown_product', bad.json?.error)

console.log('cancel')
const canceled = await call('POST', `/api/checkout_sessions/${id}/cancel`)
check('canceled', canceled.json?.status === 'canceled', canceled.json?.status)

const again = await call('POST', `/api/checkout_sessions/${id}/cancel`)
check('second cancel refused', again.status === 409 && again.json?.error?.code === 'session_terminal', again.json?.error)

const mutate = await call('POST', `/api/checkout_sessions/${id}`, { items: [{ product_id: 'sku_chai_250', quantity: 1 }] })
check('terminal session immutable', mutate.status === 409, mutate.json?.error)

console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
