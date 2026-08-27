import { StubExecutor, type PaymentExecutor } from './executor.ts'

/** Swapped for the Razorpay executor once test-mode credentials are present. */
export function executor(): PaymentExecutor {
  return new StubExecutor()
}
