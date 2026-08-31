import { db, nowIso } from '../db/client.ts'
import { paymentId } from '../ids.ts'
import type { Paise } from '../money.ts'
import { ApiError } from '../http.ts'

export interface PaymentRow {
  id: string
  session_id: string
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  amount_paise: number
  currency: string
  status: string
  created_at: string
}

/**
 * Reserves the single live payment slot for a session. The partial unique
 * index rejects a second live row, so a duplicate charge fails at the database
 * even if every check above it were bypassed.
 */
export function reserve(sessionId: string, amountPaise: Paise, currency: string): PaymentRow {
  try {
    return db()
      .prepare(
        `INSERT INTO payments (id, session_id, amount_paise, currency, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?) RETURNING *`,
      )
      .get(paymentId(), sessionId, amountPaise, currency, nowIso()) as unknown as PaymentRow
  } catch {
    throw new ApiError(409, 'payment_already_exists', 'this session already has a live payment')
  }
}

/**
 * `authorized` is an accepted instruction awaiting capture. It is deliberately
 * not `failed`, so the partial unique index keeps holding the session's single
 * payment slot while the provider webhook is outstanding.
 */
export function settle(
  id: string,
  status: 'captured' | 'authorized' | 'failed' | 'pending',
  refs: { reference?: string | null; providerOrderId?: string | null } = {},
): void {
  db()
    .prepare(
      `UPDATE payments
          SET status = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id),
              razorpay_order_id = COALESCE(?, razorpay_order_id)
        WHERE id = ?`,
    )
    .run(status, refs.reference ?? null, refs.providerOrderId ?? null, id)
}

export const forSession = (sessionId: string): PaymentRow[] =>
  db()
    .prepare('SELECT * FROM payments WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as unknown as PaymentRow[]
