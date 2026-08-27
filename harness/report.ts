import { db, nowIso } from '../lib/db/client.ts'
import { ATTACKS, resetCatalog } from './attacks.ts'
import { AgentClient } from './client.ts'

const client = new AgentClient()
const rows: Array<{
  id: number
  name: string
  expected: string
  actual: string
  refused: boolean
  setupFailed: boolean
  detail: string
}> = []

console.log('Running the adversarial suite against a live merchant.\n')

for (const attack of ATTACKS) {
  const result = await attack.run(client)
  const matched =
    result.refused && (result.code === attack.expected || attack.expected === 'exactly one charge')

  rows.push({
    id: attack.id,
    name: attack.name,
    expected: attack.expected,
    actual: result.code,
    refused: matched,
    setupFailed: result.setupFailed === true,
    detail: result.detail,
  })

  db()
    .prepare(
      `INSERT INTO attack_results (id, name, premise, expected, actual, refused, detail, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, premise = excluded.premise, expected = excluded.expected,
         actual = excluded.actual, refused = excluded.refused, detail = excluded.detail,
         ran_at = excluded.ran_at`,
    )
    .run(attack.id, attack.name, attack.premise, attack.expected, result.code, matched ? 1 : 0, result.detail, nowIso())

  const label = matched ? 'REFUSED ' : result.setupFailed ? 'NO RESULT' : 'BREACH  '
  console.log(`  ${label} ${String(attack.id).padStart(2)}. ${attack.name}`)
  console.log(`              ${attack.premise}`)
  console.log(`              -> ${result.code}${result.detail ? `  (${result.detail})` : ''}`)
}

resetCatalog()

const held = rows.filter((r) => r.refused).length
const breaches = rows.filter((r) => !r.refused && !r.setupFailed)
const inconclusive = rows.filter((r) => r.setupFailed)

console.log(`\n${held} of ${rows.length} attacks refused.`)

if (breaches.length > 0) {
  console.log('\nBREACHES - an attack got through:')
  for (const row of breaches) {
    console.log(`  ${row.id}. ${row.name}: expected ${row.expected}, got ${row.actual}`)
  }
}

if (inconclusive.length > 0) {
  console.log('\nINCONCLUSIVE - the attack could not be set up, so nothing was proved:')
  for (const row of inconclusive) {
    console.log(`  ${row.id}. ${row.name}: ${row.detail}`)
  }
  console.log('\n  These need a completed purchase first. Against live Razorpay test keys that')
  console.log('  step can be throttled; with no keys set the stub executor is deterministic.')
}

// A suite that could not run has cleared nothing, so it still fails loudly.
process.exit(held === rows.length ? 0 : 1)
