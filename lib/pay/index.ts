import { StubExecutor, type PaymentExecutor } from './executor.ts'
import { RazorpayExecutor } from './razorpay.ts'

/**
 * Razorpay is used whenever test-mode credentials are present. Without them
 * the stub runs, so the repository stays clone-and-run and the test suite
 * never depends on a network call.
 */
export function executor(): PaymentExecutor {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (keyId && keySecret) return new RazorpayExecutor(keyId, keySecret)
  return new StubExecutor()
}
