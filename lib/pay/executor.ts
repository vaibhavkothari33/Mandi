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
    return {
      outcome: 'succeeded',
      reference: `stub_pay_${intent.idempotencyKey.slice(0, 12)}`,
      providerOrderId: `stub_order_${intent.sessionId.slice(3, 15)}`,
      message: 'settled by the stub executor',
    }
  }
}
