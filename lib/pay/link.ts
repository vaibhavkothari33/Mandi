import { baseUrl } from '../config.ts'

/**
 * Where a human goes to pay a session that is waiting on capture.
 *
 * This is the merchant's own page, not a Razorpay payment link. Test mode caps
 * an account at thirty live payment links, and a capped account silently loses
 * the ability to be paid at all; a hosted page has no such ceiling and drives
 * the same order, so it produces the same signed capture webhook.
 */
export const payUrl = (sessionId: string): string => `${baseUrl()}/pay/${sessionId}`

/**
 * Where a human goes to grant consent and pay in one step.
 *
 * The approval id is the capability this link carries, which is why it is
 * generated from a cryptographic source rather than `Math.random`.
 */
export const approveUrl = (approvalId: string): string => `${baseUrl()}/approve/${approvalId}`
