import { createHmac, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/**
 * Drives the Razorpay capture path end to end without the dashboard.
 *
 * The webhook route is the only thing that can complete a sale, and until a
 * real event arrives it is the least exercised code in the app. This script
 * signs a `payment.captured` body with the endpoint secret exactly as Razorpay
 * would and posts it at the running server, so the route runs for real:
 * signature check, settle, session transition, receipt.
 *
 * It proves rejection first. An unsigned body must be refused before a signed
 * one is trusted, otherwise a 200 says nothing about whether the check works.
 *
 *   npm run webhook:test                  latest uncaptured order
 *   npm run webhook:test -- order_XXX     a specific order
 *   npm run webhook:test -- --failed      send payment.failed instead
 */

process.loadEnvFile()

const args = process.argv.slice(2)
const failed = args.includes('--failed')
const event = failed ? 'payment.failed' : 'payment.captured'
const base = process.env.BASE_URL ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
const url = `${base}/api/webhooks/razorpay`
const secret = process.env.RAZORPAY_WEBHOOK_SECRET

if (!secret) {
  console.error('RAZORPAY_WEBHOOK_SECRET is not set; the route would answer 503 webhooks_disabled')
  process.exit(1)
}

// Read-only so the dev server keeps its own handle on the database.
const path = process.env.DB_PATH ?? './mandi.db'
const store = new DatabaseSync(path, { readOnly: true })

type PaymentRow = { id: string; session_id: string; razorpay_order_id: string; status: string; amount_paise: number }
type SessionRow = { status: string }

function payment(orderId: string): PaymentRow | undefined {
  return store
    .prepare('SELECT id, session_id, razorpay_order_id, status, amount_paise FROM payments WHERE razorpay_order_id = ?')
    .get(orderId) as PaymentRow | undefined
}

function session(id: string): string {
  return (store.prepare('SELECT status FROM checkout_sessions WHERE id = ?').get(id) as SessionRow | undefined)?.status ?? '(missing)'
}

const explicit = args.find((a) => !a.startsWith('--'))
const target =
  explicit ??
  (
    store
      .prepare(
        `SELECT razorpay_order_id FROM payments
          WHERE status != 'captured' AND razorpay_order_id IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as { razorpay_order_id: string } | undefined
  )?.razorpay_order_id

if (!target) {
  console.error('no uncaptured payment to settle; pass an order id explicitly')
  process.exit(1)
}

const before = payment(target)

if (!before) {
  console.error(`no payment row for ${target}`)
  process.exit(1)
}

console.log(`target   ${target}`)
console.log(`payment  ${before.id}  ${before.status}  ${(before.amount_paise / 100).toFixed(2)} INR`)
console.log(`session  ${before.session_id}  ${session(before.session_id)}`)
console.log(`posting  ${event} -> ${url}`)
if (!failed) console.log('note     a capture completes the session and sends a real receipt email')
console.log()

/** Shaped like the Razorpay event: the route reads payload.payment.entity. */
const body = JSON.stringify({
  entity: 'event',
  event,
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: `pay_${randomBytes(7).toString('hex')}`,
        entity: 'payment',
        order_id: target,
        status: failed ? 'failed' : 'captured',
        amount: before.amount_paise,
        currency: 'INR',
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
})

function post(signature: string) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
    body,
  })
}

let failures = 0

function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  const suffix = ok || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${suffix}`)
}

const forged = await post(createHmac('sha256', 'not-the-endpoint-secret').update(body, 'utf8').digest('hex'))
check('forged signature refused with 401', forged.status === 401, forged.status)

const signed = await post(createHmac('sha256', secret).update(body, 'utf8').digest('hex'))
check('signed event accepted with 200', signed.status === 200, { status: signed.status, body: await signed.text() })

// Same body twice: Razorpay retries until it sees a 200, so redelivery must be
// a no-op rather than a second settlement.
const replay = await post(createHmac('sha256', secret).update(body, 'utf8').digest('hex'))
check('redelivery is idempotent', replay.status === 200, replay.status)

const after = payment(target)
const expectedPayment = failed ? 'failed' : 'captured'
const expectedSession = failed ? 'ready_for_payment' : 'completed'

check(`payment is ${expectedPayment}`, after?.status === expectedPayment, after?.status)
check(`session is ${expectedSession}`, session(before.session_id) === expectedSession, session(before.session_id))

const trail = store
  .prepare(`SELECT actor, action, decision, reason FROM audit_log WHERE actor = 'razorpay_webhook' ORDER BY seq DESC LIMIT 4`)
  .all() as { actor: string; action: string; decision: string; reason: string | null }[]

check('webhook wrote an audit trail', trail.length > 0)
for (const row of trail.reverse()) console.log(`         ${row.action}  ${row.decision}  ${row.reason ?? ''}`)

console.log()
console.log(failures === 0 ? 'capture path works' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
