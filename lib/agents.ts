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

export function registerAgent(id: string, name: string, secret: string): void {
  db()
    .prepare(
      `INSERT INTO agents (id, name, secret, active, created_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, secret = excluded.secret`,
    )
    .run(id, name, secret, nowIso())
}
