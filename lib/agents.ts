import { db, nowIso } from './db/client.ts'

export interface Agent {
  id: string
  name: string
  secret: string
  active: number
  created_at: string
}

export const getAgent = (id: string): Agent | undefined =>
  db().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined

/**
 * Identities the merchant reserves for itself. They hold no secret, so no
 * caller can ever authenticate as one, which is what keeps the browser
 * checkout out of reach of a buyer agent.
 */
export const RESERVED_PREFIX = 'human:'

export function registerAgent(id: string, name: string, secret: string): void {
  if (id.startsWith(RESERVED_PREFIX)) {
    throw new Error(`${id} is a reserved identity and cannot be given credentials`)
  }

  db()
    .prepare(
      `INSERT INTO agents (id, name, secret, active, created_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, secret = excluded.secret`,
    )
    .run(id, name, secret, nowIso())
}
