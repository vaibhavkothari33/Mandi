import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const g = globalThis as unknown as { __mandiDb?: DatabaseSync }

export function db(): DatabaseSync {
  if (g.__mandiDb) return g.__mandiDb

  const path = process.env.DB_PATH ?? join(process.cwd(), 'mandi.db')
  const handle = new DatabaseSync(path)
  handle.exec(readFileSync(join(process.cwd(), 'lib/db/schema.sql'), 'utf8'))

  g.__mandiDb = handle
  return handle
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
