import { createHmac, timingSafeEqual } from 'node:crypto'
import { append } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { settle } from '@/lib/pay/store'

export const dynamic = 'force-dynamic'

function signatureMatches(raw: string, presented: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Razorpay signs webhooks with the endpoint secret. An unverified body is
 * discarded before it can touch a payment record: anyone can POST here.
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
    .prepare('SELECT id, session_id FROM payments WHERE razorpay_order_id = ?')
    .get(orderId) as { id: string; session_id: string } | undefined

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

  append({
    sessionId: payment.session_id,
    actor: 'razorpay_webhook',
    action: 'webhook.settle',
    decision: captured ? 'allow' : 'refuse',
    reason: event.event ?? null,
    detail: { payment: payment.id, order_id: orderId, razorpay_payment_id: entity?.id ?? null },
  })

  return Response.json({ received: true })
}
