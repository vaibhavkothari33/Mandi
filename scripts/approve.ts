import { formatInr } from '../lib/money.ts'
import * as wallet from '../lib/wallet.ts'

const args = process.argv.slice(2)
const deny = args.includes('--deny')
const revoke = args.includes('--revoke')
const id = args.find((a) => !a.startsWith('--'))

if (!id) {
  const queue = wallet.pending()
  const live = wallet.outstanding()

  if (queue.length === 0) {
    console.log('no approvals waiting')
  } else {
    console.log(`${queue.length} approval(s) waiting:
`)
    for (const a of queue) {
      console.log(`  ${a.id}  ${formatInr(a.amount_paise)}  ${a.summary}`)
      console.log(`     session ${a.session_id}  requested by ${a.agent_id}`)
    }
    console.log(`
approve:  npm run approve -- ${queue[0].id}`)
    console.log(`deny:     npm run approve -- --deny ${queue[0].id}`)
  }

  if (live.length > 0) {
    console.log(`
${live.length} approval(s) granted but not yet spent — still live authority:
`)
    for (const a of live) {
      console.log(`  ${a.id}  ${formatInr(a.amount_paise)}  ${a.summary}`)
    }
    console.log(`
revoke:   npm run approve -- --revoke ${live[0].id}`)
  }

  process.exit(0)
}

if (revoke) {
  const revoked = wallet.revoke(id)
  console.log(`revoked ${revoked.id} — ${formatInr(revoked.amount_paise)} is no longer spendable`)
  console.log('  the cart mandate is consumed, so the gate now refuses it')
  process.exit(0)
}

const decided = deny ? wallet.deny(id) : wallet.approve(id)

if (decided.status === 'denied') {
  console.log(`denied ${decided.id}`)
} else {
  console.log(`approved ${decided.id} for ${formatInr(decided.amount_paise)}`)
  console.log(`  ${decided.summary}`)
  console.log('  mandates signed and attached to the approval')
}
