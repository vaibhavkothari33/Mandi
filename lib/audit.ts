import { db, nowIso } from './db/client.ts'
import { canonicalize, sha256 } from './canonical.ts'

export type Decision = 'allow' | 'refuse' | 'info'

export interface AuditEntry {
  sessionId?: string | null
  actor: string
  action: string
  decision: Decision
  reason?: string | null
  detail?: Record<string, unknown>
}

export function append(entry: AuditEntry): { seq: number; hash: string } {
  const handle = db()
  const at = nowIso()

  const prev = handle
    .prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')
    .get() as { hash: string } | undefined
  const prevHash = prev?.hash ?? null

  const detail = entry.detail ?? {}
  const hash = sha256(
    canonicalize({
      prevHash,
      sessionId: entry.sessionId ?? null,
      actor: entry.actor,
      action: entry.action,
      decision: entry.decision,
      reason: entry.reason ?? null,
      detail,
      at,
    }),
  )

  const row = handle
    .prepare(
      `INSERT INTO audit_log
         (session_id, actor, action, decision, reason, detail_json, prev_hash, hash, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING seq`,
    )
    .get(
      entry.sessionId ?? null,
      entry.actor,
      entry.action,
      entry.decision,
      entry.reason ?? null,
      JSON.stringify(detail),
      prevHash,
      hash,
      at,
    ) as { seq: number }

  return { seq: row.seq, hash }
}

export interface AuditRow {
  seq: number
  session_id: string | null
  actor: string
  action: string
  decision: Decision
  reason: string | null
  detail_json: string
  prev_hash: string | null
  hash: string
  at: string
}

export function forSession(sessionId: string): AuditRow[] {
  return db()
    .prepare('SELECT * FROM audit_log WHERE session_id = ? ORDER BY seq')
    .all(sessionId) as unknown as AuditRow[]
}

/** Recomputes the chain and reports the first row that fails to verify. */
export function verifyChain(): { ok: boolean; brokenAt?: number } {
  const rows = db().prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[]
  let prevHash: string | null = null

  for (const row of rows) {
    const expected = sha256(
      canonicalize({
        prevHash,
        sessionId: row.session_id,
        actor: row.actor,
        action: row.action,
        decision: row.decision,
        reason: row.reason,
        detail: JSON.parse(row.detail_json),
        at: row.at,
      }),
    )
    if (expected !== row.hash || row.prev_hash !== prevHash) {
      return { ok: false, brokenAt: row.seq }
    }
    prevHash = row.hash
  }

  return { ok: true }
}
