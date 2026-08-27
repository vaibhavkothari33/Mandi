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
   * Creates a real test-mode order and a UPI payment link for it.
   *
   * Test mode has no payer, so no capture event can occur here. `succeeded`
   * therefore means the provider accepted the instruction and issued real
   * identifiers; the webhook route is what moves a payment to captured in a
   * live flow. The README states this limitation explicitly.
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

    try {
      const response = await this.call(
        '/payment_links',
        {
          amount: intent.amountPaise,
          currency: intent.currency,
          description: intent.description,
          reference_id: `${intent.sessionId}:${intent.idempotencyKey.slice(0, 8)}`,
          notify: { sms: false, email: false },
          upi_link: true,
        },
        `${intent.idempotencyKey}:link`,
      )

      const payload = (await response.json()) as {
        id?: string
        short_url?: string
        error?: { description?: string }
      }

      if (!response.ok || !payload.id) {
        return this.indeterminate(order.id, payload.error?.description ?? `link rejected with ${response.status}`)
      }

      return {
        outcome: 'succeeded',
        reference: payload.id,
        providerOrderId: order.id,
        message: payload.short_url ?? 'payment link created',
      }
    } catch (err) {
      return this.indeterminate(order.id, (err as Error).message)
    }
  }

  private indeterminate(orderId: string | null, message: string): PaymentResult {
    return { outcome: 'unknown', reference: null, providerOrderId: orderId, message }
  }
}
