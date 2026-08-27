import { db, nowIso } from '../db/client.ts'
import type { CartPayload, IntentPayload, MandatePayload } from './types.ts'

export interface MandateRow {
  id: string
  kind: 'intent' | 'cart'
  subject: string
  agent_id: string
  intent_id: string | null
  session_id: string | null
  scope_json: string
  cart_hash: string | null
  amount_paise: number | null
  jws: string
  issued_at: string
  expires_at: string
  consumed_at: string | null
}

export function save(payload: MandatePayload, jws: string): void {
  const isCart = payload.kind === 'cart'
  const cart = payload as CartPayload
  const intent = payload as IntentPayload

  db()
    .prepare(
      `INSERT INTO mandates
         (id, kind, subject, agent_id, intent_id, session_id, scope_json, cart_hash,
          amount_paise, jws, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.jti,
      payload.kind,
      payload.sub,
      payload.agent,
      isCart ? cart.intent_jti : null,
      isCart ? cart.session_id : null,
      JSON.stringify(isCart ? {} : intent.scope),
      isCart ? cart.cart_hash : null,
      isCart ? cart.amount_paise : null,
      jws,
      new Date(payload.iat * 1000).toISOString(),
      new Date(payload.exp * 1000).toISOString(),
    )
}

export const byJti = (jti: string): MandateRow | undefined =>
  db().prepare('SELECT * FROM mandates WHERE id = ?').get(jti) as MandateRow | undefined

/**
 * Single-use enforcement. The UPDATE is conditional on the mandate still being
 * unconsumed, so two concurrent completions cannot both claim it.
 */
export function consume(jti: string): boolean {
  const result = db()
    .prepare('UPDATE mandates SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .run(nowIso(), jti)
  return result.changes === 1
}

/** Total already drawn against an intent by consumed cart mandates. */
export function drawdown(intentJti: string): number {
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(amount_paise), 0) AS spent, COUNT(*) AS uses
         FROM mandates
        WHERE intent_id = ? AND kind = 'cart' AND consumed_at IS NOT NULL`,
    )
    .get(intentJti) as { spent: number; uses: number }
  return row.spent
}

export function usageCount(intentJti: string): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS uses FROM mandates
        WHERE intent_id = ? AND kind = 'cart' AND consumed_at IS NOT NULL`,
    )
    .get(intentJti) as { uses: number }
  return row.uses
}
