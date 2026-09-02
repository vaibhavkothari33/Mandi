import { createHmac, timingSafeEqual } from 'node:crypto'
import { append } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { consume as consumeMandate, release as releaseMandate } from '@/lib/mandate/store'
import { settle } from '@/lib/pay/store'
import { sendPurchaseReceipt } from '@/lib/receipt'
import { get as getSession, update as updateSession } from '@/lib/session/store'

export const dynamic = 'force-dynamic'

function signatureMatches(raw: string, presented: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The cart mandate that was burnt to authorise this session's payment. */
function cartMandateFor(sessionId: string): string | null {
  const row = db()
    .prepare(
      `SELECT id FROM mandates
        WHERE session_id = ? AND kind = 'cart' AND consumed_at IS NOT NULL
        ORDER BY consumed_at DESC LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined
  return row?.id ?? null
}

/** The cart mandate for a session whether or not it is currently burnt. */
function anyCartMandateFor(sessionId: string): string | null {
  const row = db()
    .prepare(
      `SELECT id FROM mandates WHERE session_id = ? AND kind = 'cart'
        ORDER BY issued_at DESC LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined
  return row?.id ?? null
}

/**
 * Razorpay signs webhooks with the endpoint secret. An unverified body is
 * discarded before it can touch a payment record: anyone can POST here.
 *
 * This route is where a real sale completes. The checkout path can only put a
 * session into `pending_payment`; a signed `payment.captured` event is the
 * merchant's first evidence that money actually moved, so it is the only thing
 * that advances the session to `completed` and sends the receipt.
 */
export async function POST(request: Request) {
  const raw = await request.text()
  const presented = request.headers.get('X-Razorpay-Signature')
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!secret) {
    return Response.json({ error: { code: 'webhooks_disabled' } }, { status: 503 })
  }

  if (!presented || !signatureMatches(raw, presented, secret)) {
    append({
      actor: 'razorpay_webhook',
      action: 'webhook.receive',
      decision: 'refuse',
      reason: 'invalid_signature',
      detail: { bytes: raw.length },
    })
    return Response.json({ error: { code: 'invalid_signature' } }, { status: 401 })
  }

  const event = JSON.parse(raw) as {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } }
  }

  const entity = event.payload?.payment?.entity
  const orderId = entity?.order_id

  if (!orderId) {
    append({
      actor: 'razorpay_webhook',
      action: 'webhook.receive',
      decision: 'info',
      reason: 'ignored',
      detail: { event: event.event ?? null },
    })
    return Response.json({ received: true })
  }

  const payment = db()
    .prepare('SELECT id, session_id, amount_paise FROM payments WHERE razorpay_order_id = ?')
    .get(orderId) as { id: string; session_id: string; amount_paise: number } | undefined

  if (!payment) {
    append({
      actor: 'razorpay_webhook',
      action: 'webhook.receive',
      decision: 'info',
      reason: 'unknown_order',
      detail: { event: event.event ?? null, order_id: orderId },
    })
    return Response.json({ received: true })
  }

  const captured = event.event === 'payment.captured'
  settle(payment.id, captured ? 'captured' : 'failed', { reference: entity?.id ?? null })

  // Redelivery is expected: Razorpay retries until it gets a 200. A session
  // already past `pending_payment` has nothing left to move, so the transition
  // is attempted only from there and a repeat is a no-op rather than an error.
  const session = getSession(payment.session_id)
  let moved = false

  if (captured) {
    // A confirmed capture is the final word, and it can arrive at a session
    // this route already unwound: a card that declines and is then retried in
    // the same checkout produces payment.failed followed by payment.captured.
    // Completing only from `pending_payment` left those orders paid for but
    // unfinished, so any state a payment can still be settled from completes.
    if (session.status === 'pending_payment' || session.status === 'ready_for_payment') {
      // The failure released the mandate. Money moved on the retry, so burn it
      // again rather than leaving spendable consent behind a completed sale.
      const mandate = anyCartMandateFor(session.id)
      if (mandate) consumeMandate(mandate)

      // The machine has no edge from `ready_for_payment` straight to
      // `completed`, and it should not: a sale is always paid for from
      // `pending_payment`. A retry genuinely re-enters payment, so it is walked
      // back through that state rather than the edge being widened.
      const paying =
        session.status === 'pending_payment'
          ? session
          : updateSession(session.id, session.version, { status: 'pending_payment' })

      const completed = updateSession(paying.id, paying.version, { status: 'completed' })
      moved = true

      void sendPurchaseReceipt({
        session: completed,
        paymentReference: entity?.id ?? null,
        amountPaise: payment.amount_paise,
      }).catch((err) => console.error('Purchase receipt email failed', err))
    }
  } else if (session.status === 'pending_payment') {
    // A definitive failure is safe to unwind: the buyer keeps their consent
    // and the session becomes payable again.
    const mandate = cartMandateFor(session.id)
    if (mandate) releaseMandate(mandate)
    updateSession(session.id, session.version, { status: 'ready_for_payment' })
    moved = true
  }

  append({
    sessionId: payment.session_id,
    actor: 'razorpay_webhook',
    action: 'webhook.settle',
    decision: captured ? 'allow' : 'refuse',
    reason: event.event ?? null,
    detail: {
      payment: payment.id,
      order_id: orderId,
      razorpay_payment_id: entity?.id ?? null,
      session_status_before: session.status,
      session_advanced: moved,
    },
  })

  return Response.json({ received: true })
}
