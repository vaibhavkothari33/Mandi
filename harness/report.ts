import { db, nowIso } from '../lib/db/client.ts'
import { ATTACKS, resetCatalog } from './attacks.ts'
import { AgentClient } from './client.ts'

const client = new AgentClient()
const rows: Array<{ id: number; name: string; expected: string; actual: string; refused: boolean; detail: string }> = []

console.log('Running the adversarial suite against a live merchant.\n')

for (const attack of ATTACKS) {
  const result = await attack.run(client)
  const matched = result.refused && (result.code === attack.expected || attack.expected === 'exactly one charge')

  rows.push({
    id: attack.id,
    name: attack.name,
    expected: attack.expected,
    actual: result.code,
    refused: matched,
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

  console.log(`  ${matched ? 'REFUSED ' : 'BREACH  '} ${String(attack.id).padStart(2)}. ${attack.name}`)
  console.log(`              ${attack.premise}`)
  console.log(`              -> ${result.code}${result.detail ? `  (${result.detail})` : ''}`)
}

resetCatalog()

const held = rows.filter((r) => r.refused).length
console.log(`\n${held} of ${rows.length} attacks refused.`)

if (held !== rows.length) {
  console.log('\nBREACHES:')
  for (const row of rows.filter((r) => !r.refused)) {
    console.log(`  ${row.id}. ${row.name}: expected ${row.expected}, got ${row.actual}`)
  }
}

process.exit(held === rows.length ? 0 : 1)
