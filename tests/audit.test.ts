import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

const ctx = freshDb()

const { db } = await import('../lib/db/client.ts')
const { append, forSession, verifyChain } = await import('../lib/audit.ts')
const { ensureKeypair } = await import('../lib/mandate/keys.ts')

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

test('every entry carries an Ed25519 signature over its hash', () => {
  db().prepare('DELETE FROM audit_log').run()

  const entry = append({ sessionId: 'cs_5', actor: 'agent', action: 'gate.evaluate', decision: 'allow' })
  const row = forSession('cs_5')[0]

  assert.ok(entry.signature, 'append must return the signature it wrote')
  assert.equal(row.signature, entry.signature)
  assert.equal(row.kid, ensureKeypair().kid)

  const verdict = verifyChain()
  assert.equal(verdict.ok, true)
  assert.equal(verdict.signed, 1)
  assert.equal(verdict.unsigned, 0)
})

test('a rewritten entry re-hashed to look consistent is still caught by its signature', () => {
  db().prepare('DELETE FROM audit_log').run()

  append({ sessionId: 'cs_6', actor: 'agent', action: 'gate.evaluate', decision: 'refuse', reason: 'scope_exceeded' })

  // An attacker with write access can recompute the hash chain: it needs no
  // secret. Rewrite the row and its hash so the chain itself still validates.
  const forged = append({ sessionId: 'cs_6', actor: 'agent', action: 'gate.evaluate', decision: 'allow' })
  const good = db().prepare('SELECT hash, signature FROM audit_log WHERE seq = ?').get(forged.seq) as {
    hash: string
    signature: string
  }
  db().prepare('DELETE FROM audit_log').run()

  const first = append({ sessionId: 'cs_6', actor: 'agent', action: 'gate.evaluate', decision: 'refuse', reason: 'scope_exceeded' })
  db()
    .prepare("UPDATE audit_log SET decision = 'allow', reason = NULL, hash = ?, signature = ? WHERE seq = ?")
    .run(good.hash, good.signature, first.seq)

  // The chain would accept it. The signature does not: it was made over a
  // different hash, and forging one needs the merchant's private key.
  const verdict = verifyChain()
  assert.equal(verdict.ok, false)
  assert.equal(verdict.brokenAt, first.seq)
  assert.equal(verdict.reason, 'hash_mismatch')
})

test('an unsigned legacy row is reported as unsigned, not as tampered', () => {
  db().prepare('DELETE FROM audit_log').run()

  const entry = append({ sessionId: 'cs_7', actor: 'agent', action: 'a', decision: 'allow' })
  db().prepare('UPDATE audit_log SET kid = NULL, signature = NULL WHERE seq = ?').run(entry.seq)

  const verdict = verifyChain()
  assert.equal(verdict.ok, true)
  assert.equal(verdict.unsigned, 1)
  assert.equal(verdict.signed, 0)
})

test('a signature lifted from another entry does not validate', () => {
  db().prepare('DELETE FROM audit_log').run()

  const first = append({ sessionId: 'cs_8', actor: 'agent', action: 'a', decision: 'allow' })
  const second = append({ sessionId: 'cs_8', actor: 'agent', action: 'b', decision: 'refuse', reason: 'nope' })
  const lifted = db().prepare('SELECT signature FROM audit_log WHERE seq = ?').get(first.seq) as {
    signature: string
  }

  db().prepare('UPDATE audit_log SET signature = ? WHERE seq = ?').run(lifted.signature, second.seq)

  const verdict = verifyChain()
  assert.equal(verdict.ok, false)
  assert.equal(verdict.brokenAt, second.seq)
  assert.equal(verdict.reason, 'bad_signature')
})
