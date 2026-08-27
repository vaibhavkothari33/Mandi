import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

const ctx = freshDb()

const { db } = await import('../lib/db/client.ts')
const { append, forSession, verifyChain } = await import('../lib/audit.ts')

after(async () => ctx.cleanup())

test('entries chain to their predecessor', () => {
  const a = append({ sessionId: 'cs_1', actor: 'agent', action: 'session.create', decision: 'allow' })
  const b = append({ sessionId: 'cs_1', actor: 'agent', action: 'session.update', decision: 'allow' })

  assert.notEqual(a.hash, b.hash)
  const rows = forSession('cs_1')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].prev_hash, null)
  assert.equal(rows[1].prev_hash, a.hash)
  assert.equal(verifyChain().ok, true)
})

test('an identical action logged twice still produces distinct hashes', () => {
  const first = append({ sessionId: 'cs_2', actor: 'agent', action: 'noop', decision: 'info' })
  const second = append({ sessionId: 'cs_2', actor: 'agent', action: 'noop', decision: 'info' })
  assert.notEqual(first.hash, second.hash)
})

test('flipping a refusal to an allowance is detected', () => {
  append({ sessionId: 'cs_3', actor: 'agent', action: 'session.complete', decision: 'refuse', reason: 'scope_exceeded' })
  append({ sessionId: 'cs_3', actor: 'agent', action: 'session.cancel', decision: 'allow' })
  assert.equal(verifyChain().ok, true)

  const target = db()
    .prepare("SELECT seq FROM audit_log WHERE decision = 'refuse' ORDER BY seq LIMIT 1")
    .get() as { seq: number }
  db().prepare("UPDATE audit_log SET decision = 'allow' WHERE seq = ?").run(target.seq)

  const result = verifyChain()
  assert.equal(result.ok, false)
  assert.equal(result.brokenAt, target.seq)
})

test('deleting an entry breaks the chain at the next row', () => {
  db().prepare('DELETE FROM audit_log').run()

  append({ sessionId: 'cs_4', actor: 'agent', action: 'a', decision: 'allow' })
  const middle = append({ sessionId: 'cs_4', actor: 'agent', action: 'b', decision: 'refuse', reason: 'nope' })
  const last = append({ sessionId: 'cs_4', actor: 'agent', action: 'c', decision: 'allow' })
  assert.equal(verifyChain().ok, true)

  db().prepare('DELETE FROM audit_log WHERE seq = ?').run(middle.seq)

  const result = verifyChain()
  assert.equal(result.ok, false)
  assert.equal(result.brokenAt, last.seq)
})
