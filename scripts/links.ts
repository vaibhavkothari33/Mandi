import { DatabaseSync } from 'node:sqlite'

/**
 * Lists and recycles Razorpay test-mode payment links.
 *
 * Test mode caps an account at thirty live payment links. Once the cap is hit
 * the orders still get created but no link comes back, so a buyer has nothing
 * to pay and the sale can never capture. Cancelling old links is the only way
 * to make room, and the dashboard only cancels one at a time.
 *
 *   npm run links                 list what exists, newest first
 *   npm run links -- --cancel 10  cancel the ten oldest unpaid links
 *
 * Cancelling is one-way. A cancelled link cannot be reopened, so this only
 * ever touches links that nobody has paid.
 */

process.loadEnvFile()

const args = process.argv.slice(2)
const flag = args.indexOf('--cancel')
const cancelCount = flag === -1 ? 0 : Number(args[flag + 1] ?? 0)

const keyId = process.env.RAZORPAY_KEY_ID
const keySecret = process.env.RAZORPAY_KEY_SECRET

if (!keyId || !keySecret) {
  console.error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  process.exit(1)
}

if (!keyId.startsWith('rzp_test_')) {
  console.error('refusing to run: this script only touches test-mode links')
  process.exit(1)
}

const headers = {
  Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
  'Content-Type': 'application/json',
}

type Link = { id: string; status: string; amount: number; created_at: number; short_url: string; reference_id?: string }

const listed = await fetch('https://api.razorpay.com/v1/payment_links?count=100', { headers })
const payload = (await listed.json()) as { payment_links?: Link[] }
const links = payload.payment_links ?? []

const counts: Record<string, number> = {}
for (const link of links) counts[link.status] = (counts[link.status] ?? 0) + 1

console.log(`${links.length} link(s) — ${Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(', ') || 'none'}`)
console.log(`quota: ${links.filter((l) => l.status === 'created').length}/30 live`)
console.log()

// A cancelled or paid link no longer occupies a slot; only 'created' does.
const recyclable = links.filter((l) => l.status === 'created').sort((a, b) => a.created_at - b.created_at)

if (cancelCount <= 0) {
  for (const link of links.slice(0, 10)) {
    const when = new Date(link.created_at * 1000).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  ${link.id}  ${link.status.padEnd(9)}  ${(link.amount / 100).toFixed(2).padStart(9)}  ${when}  ${link.short_url}`)
  }
  if (links.length > 10) console.log(`  ... and ${links.length - 10} more`)
  console.log()
  console.log(`free slots:  npm run links -- --cancel ${Math.min(10, recyclable.length)}`)
  process.exit(0)
}

// Never cancel a link that is still the payable route for an open session.
const store = new DatabaseSync(process.env.DB_PATH ?? './mandi.db', { readOnly: true })
const live = new Set(
  (
    store
      .prepare(`SELECT razorpay_order_id FROM payments WHERE status = 'authorized' AND razorpay_order_id IS NOT NULL`)
      .all() as { razorpay_order_id: string }[]
  ).map((r) => r.razorpay_order_id),
)

const targets = recyclable.filter((l) => !live.has(l.reference_id ?? '')).slice(0, cancelCount)
console.log(`cancelling ${targets.length} of the oldest unpaid link(s)`)

let cancelled = 0

for (const link of targets) {
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${link.id}/cancel`, { method: 'POST', headers })
  const ok = response.ok
  if (ok) cancelled++
  const detail = ok ? '' : ` -> ${(await response.text()).slice(0, 120)}`
  console.log(`  [${ok ? 'OK  ' : 'FAIL'}] ${link.id}${detail}`)
}

console.log()
console.log(`cancelled ${cancelled}; roughly ${cancelled} slot(s) should now be free`)
console.log('verify with: npm run links')
