import type { PaymentExecutor, PaymentIntent, PaymentResult } from './executor.ts'

const API = 'https://api.razorpay.com/v1'
const TIMEOUT_MS = 10_000

export class RazorpayExecutor implements PaymentExecutor {
  readonly name = 'razorpay'
  private readonly auth: string

  constructor(keyId: string, keySecret: string) {
    if (!keyId.startsWith('rzp_test_')) {
      throw new Error('refusing to start: Mandi only runs against Razorpay test-mode keys')
    }
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
  }

  private async call(path: string, body: unknown, idempotencyKey: string) {
    return fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        'X-Razorpay-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }

  /**
   * Creates a real test-mode order, and optionally a payment link for it.
   *
   * The order is the payment instruction and the artifact that matters. A
   * human pays it on the merchant's own `/pay/:session` page, which drives
   * this same order through Razorpay Checkout and has no ceiling.
   *
   * Razorpay payment links are therefore off by default: test mode caps an
   * account at thirty live ones, and every order created past that cap burns a
   * request to be refused. Set `RAZORPAY_PAYMENT_LINKS=1` to ask for one
   * anyway. Even then a refused link does not fail the payment — the order
   * stands and its id becomes the reference.
   *
   * Nothing here is a capture. Creating an order — with or without a link —
   * only registers an instruction; the payer has not paid. So every success
   * path reports `captured: false`, which holds the session at
   * `pending_payment`. The signed `payment.captured` webhook is the only thing
   * that completes a sale.
   *
   * UPI payment links are rejected outright in test mode, so a standard link
   * is used; the UPI rail is a live-mode concern.
   */
  async execute(intent: PaymentIntent): Promise<PaymentResult> {
    let order: { id: string }

    try {
      const response = await this.call(
        '/orders',
        {
          amount: intent.amountPaise,
          currency: intent.currency,
          receipt: intent.sessionId,
          notes: { session_id: intent.sessionId, source: 'mandi' },
        },
        `${intent.idempotencyKey}:order`,
      )

      if (response.status >= 500) {
        return this.indeterminate(null, `provider returned ${response.status}`)
      }

      const payload = (await response.json()) as { id?: string; error?: { description?: string } }

      if (!response.ok || !payload.id) {
        return {
          outcome: 'failed',
          captured: false,
          reference: null,
          providerOrderId: null,
          message: payload.error?.description ?? `order rejected with ${response.status}`,
        }
      }

      order = payload as { id: string }
    } catch (err) {
      // A timeout or transport fault leaves the provider's state unknown.
      return this.indeterminate(null, (err as Error).message)
    }

    if (process.env.RAZORPAY_PAYMENT_LINKS !== '1') {
      return {
        outcome: 'succeeded',
        captured: false,
        reference: order.id,
        providerOrderId: order.id,
        message: 'order created; payable on the merchant checkout page',
      }
    }

    try {
      const response = await this.call(
        '/payment_links',
        {
          amount: intent.amountPaise,
          currency: intent.currency,
          description: intent.description,
          reference_id: `${intent.sessionId}:${intent.idempotencyKey.slice(0, 8)}`,
          notify: { sms: false, email: false },
        },
        `${intent.idempotencyKey}:link`,
      )

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string
        short_url?: string
        error?: { description?: string }
      }

      if (!response.ok || !payload.id) {
        return {
          outcome: 'succeeded',
          captured: false,
          reference: order.id,
          providerOrderId: order.id,
          message: `order created; no payment link (${payload.error?.description ?? response.status})`,
        }
      }

      return {
        outcome: 'succeeded',
        captured: false,
        reference: payload.id,
        providerOrderId: order.id,
        message: payload.short_url ?? 'payment link created',
      }
    } catch {
      // The order is already placed; a link that could not be created does not
      // undo it, and no money can move either way in test mode.
      return {
        outcome: 'succeeded',
        captured: false,
        reference: order.id,
        providerOrderId: order.id,
        message: 'order created; payment link unavailable',
      }
    }
  }

  private indeterminate(orderId: string | null, message: string): PaymentResult {
    return { outcome: 'unknown', captured: false, reference: null, providerOrderId: orderId, message }
  }
}
