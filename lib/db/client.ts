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
  const columns = handle.prepare('PRAGMA table_info(approvals)').all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === 'revoked_at')) {
    handle.exec('ALTER TABLE approvals ADD COLUMN revoked_at TEXT')
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
