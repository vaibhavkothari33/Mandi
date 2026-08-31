import { sign as edSign, verify as edVerify } from 'node:crypto'
import { db, nowIso } from './db/client.ts'
import { canonicalize, sha256 } from './canonical.ts'
import { b64u, fromB64u, privateKeyFrom, publicKeyFrom } from './mandate/jws.ts'
import { ensureKeypair, publicKeyFor } from './mandate/keys.ts'

export type Decision = 'allow' | 'refuse' | 'info'

export interface AuditEntry {
  sessionId?: string | null
  actor: string
  action: string
  decision: Decision
  reason?: string | null
  detail?: Record<string, unknown>
}

/**
 * The hash chain proves the log was not reordered or edited after the fact; it
 * does not prove who wrote it. Anyone who can write the table can recompute a
 * consistent chain. The Ed25519 signature over each entry hash is what makes a
 * forged entry detectable without the original: producing one requires the
 * merchant's private key, not merely write access.
 *
 * The signature is detached and covers the hash alone, which already commits
 * to the entry's fields and to its predecessor.
 */
function signHash(hash: string): { kid: string; signature: string } | null {
  const keypair = ensureKeypair()
  if (!keypair.privateKey) return null
  const signature = edSign(null, Buffer.from(hash, 'utf8'), privateKeyFrom(keypair.privateKey))
  return { kid: keypair.kid, signature: b64u(signature) }
}

function signatureValid(hash: string, kid: string, signature: string): boolean {
  const publicKey = publicKeyFor(kid)
  if (!publicKey) return false
  try {
    return edVerify(null, Buffer.from(hash, 'utf8'), publicKeyFrom(publicKey), fromB64u(signature))
  } catch {
    return false
  }
}

export function append(entry: AuditEntry): { seq: number; hash: string; signature: string | null } {
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

  const signed = signHash(hash)

  const row = handle
    .prepare(
      `INSERT INTO audit_log
         (session_id, actor, action, decision, reason, detail_json, prev_hash, hash, kid, signature, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      signed?.kid ?? null,
      signed?.signature ?? null,
      at,
    ) as { seq: number }

  return { seq: row.seq, hash, signature: signed?.signature ?? null }
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
  kid: string | null
  signature: string | null
  at: string
}

export function forSession(sessionId: string): AuditRow[] {
  return db()
    .prepare('SELECT * FROM audit_log WHERE session_id = ? ORDER BY seq')
    .all(sessionId) as unknown as AuditRow[]
}

export interface ChainVerdict {
  ok: boolean
  brokenAt?: number
  /** Why the first failing row failed, when one did. */
  reason?: 'hash_mismatch' | 'broken_link' | 'bad_signature'
  /** Rows written before signing existed; present but unattributable. */
  unsigned: number
  signed: number
}

/**
 * Recomputes the chain, verifies each entry's signature, and reports the first
 * row that fails. A row with no signature is counted, not rejected: the log
 * predates signing rather than having been tampered with.
 */
export function verifyChain(): ChainVerdict {
  const rows = db().prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[]
  let prevHash: string | null = null
  let signed = 0
  let unsigned = 0

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

    if (expected !== row.hash) return { ok: false, brokenAt: row.seq, reason: 'hash_mismatch', signed, unsigned }
    if (row.prev_hash !== prevHash) return { ok: false, brokenAt: row.seq, reason: 'broken_link', signed, unsigned }

    if (row.signature && row.kid) {
      if (!signatureValid(row.hash, row.kid, row.signature)) {
        return { ok: false, brokenAt: row.seq, reason: 'bad_signature', signed, unsigned }
      }
      signed += 1
    } else {
      unsigned += 1
    }

    prevHash = row.hash
  }

  return { ok: true, signed, unsigned }
}
