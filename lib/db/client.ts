import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const g = globalThis as unknown as { __mandiDb?: DatabaseSync }

export function db(): DatabaseSync {
  if (g.__mandiDb) return g.__mandiDb

  const path = process.env.DB_PATH ?? join(process.cwd(), 'mandi.db')
  const handle = new DatabaseSync(path)
  handle.exec(readFileSync(join(process.cwd(), 'lib/db/schema.sql'), 'utf8'))
  migrate(handle)

  g.__mandiDb = handle
  return handle
}

/** CREATE TABLE IF NOT EXISTS cannot add columns to a database that predates them. */
function migrate(handle: DatabaseSync): void {
  const approvals = handle.prepare('PRAGMA table_info(approvals)').all() as Array<{ name: string }>
  if (!approvals.some((c) => c.name === 'revoked_at')) {
    handle.exec('ALTER TABLE approvals ADD COLUMN revoked_at TEXT')
  }

  const sessions = handle.prepare('PRAGMA table_info(checkout_sessions)').all() as Array<{ name: string }>
  if (!sessions.some((c) => c.name === 'claim_token_hash')) {
    handle.exec('ALTER TABLE checkout_sessions ADD COLUMN claim_token_hash TEXT')
  }

  // Entries written before the log was signed keep NULL kid/signature. The
  // verifier reports them as unsigned rather than as tampered.
  const audit = handle.prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string }>
  if (!audit.some((c) => c.name === 'signature')) {
    handle.exec('ALTER TABLE audit_log ADD COLUMN kid TEXT')
    handle.exec('ALTER TABLE audit_log ADD COLUMN signature TEXT')
  }
}

export function close(): void {
  if (!g.__mandiDb) return
  g.__mandiDb.close()
  g.__mandiDb = undefined
}

export function tx<T>(fn: () => T): T {
  const handle = db()
  handle.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    handle.exec('COMMIT')
    return out
  } catch (err) {
    handle.exec('ROLLBACK')
    throw err
  }
}

export const nowIso = () => new Date().toISOString()
