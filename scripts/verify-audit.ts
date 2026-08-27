import { db } from '../lib/db/client.ts'
import { verifyChain } from '../lib/audit.ts'

const rows = db().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }
const result = verifyChain()

console.log(`audit entries: ${rows.n}`)
console.log(result.ok ? 'chain intact' : `chain broken at seq ${result.brokenAt}`)
process.exit(result.ok ? 0 : 1)
