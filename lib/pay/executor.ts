import type { Paise } from '../money.ts'

export interface PaymentIntent {
  sessionId: string
  amountPaise: Paise
  currency: string
  idempotencyKey: string
  description: string
}

/**
 * `failed` means the provider definitively declined and no money moved.
 * `unknown` means the outcome could not be established — a timeout or an
 * unreadable response. The two must never be collapsed: `failed` is safe to
 * release and retry, `unknown` is not.
 */
export type PaymentOutcome = 'succeeded' | 'failed' | 'unknown'

export interface PaymentResult {
  outcome: PaymentOutcome
  /**
   * Whether money actually moved and the merchant has confirmation of it.
   *
   * `outcome: 'succeeded'` only says the provider accepted the instruction and
   * issued identifiers for it. An accepted order is not a captured payment: a
   * provider that returns a payment link has taken nothing yet. Only a
   * confirmed capture may complete a session, so an executor that cannot
   * observe one reports `captured: false` and leaves the session pending until
   * the signed provider webhook says otherwise.
   */
  captured: boolean
  reference: string | null
  providerOrderId: string | null
  message: string
}

export interface PaymentExecutor {
  readonly name: string
  execute(intent: PaymentIntent): Promise<PaymentResult>
}

/** Stands in for the provider until the Razorpay executor is wired. */
export class StubExecutor implements PaymentExecutor {
  readonly name = 'stub'

  async execute(intent: PaymentIntent): Promise<PaymentResult> {
    // The stub is its own payment rail, so it observes its own capture.
    return {
      outcome: 'succeeded',
      captured: true,
      reference: `stub_pay_${intent.idempotencyKey.slice(0, 12)}`,
      providerOrderId: `stub_order_${intent.sessionId.slice(3, 15)}`,
      message: 'settled by the stub executor',
    }
  }
}
