import { gateAllowed } from '../lib/http.ts'
import { formatInr } from '../lib/money.ts'
import * as wallet from '../lib/wallet.ts'
import { ADDRESS, AgentClient } from './client.ts'

/**
 * An honest buyer agent walking the full flow.
 *
 * The agent discovers, builds a cart and asks to be paid for. It cannot sign
 * its own consent: the approval step is performed here by the wallet, standing
 * in for a human confirming on their own device.
 */
const client = new AgentClient()
const step = (n: number, label: string) => console.log(`\n${n}. ${label}`)

step(1, 'discover the merchant')
const manifest = await client.get('/.well-known/agent-commerce')
console.log(`   ${manifest.json.merchant.name} speaks ${manifest.json.protocol.checkout}`)
console.log(`   quotes live ${manifest.json.limits.quote_ttl_seconds}s`)

step(2, 'read the catalogue')
const catalog = await client.get('/api/catalog')
const wanted = catalog.json.items
  .filter((i: any) => i.category === 'grocery' && i.availability === 'in_stock')
  .slice(0, 2)
for (const item of wanted) {
  console.log(`   ${item.title} ${formatInr(item.price.amount_paise)}`)
}

step(3, 'open a checkout session')
const created = await client.post('/api/checkout_sessions', {
  items: wanted.map((i: any) => ({ product_id: i.id, quantity: 1 })),
  fulfillment: ADDRESS,
})
const id = created.json.id
console.log(`   ${id} is ${created.json.status}`)
console.log(`   total ${formatInr(created.json.totals.total_paise)}`)

step(4, 'lock a price')
const quote = await client.post(`/api/checkout_sessions/${id}/quote`, {})
console.log(`   ${quote.json.id} valid for ${quote.json.expires_in_seconds}s`)

step(5, 'ask the human for consent')
const approval = wallet.request(id, client.agentId)
console.log(`   ${approval.id} pending`)
console.log(`   the agent cannot proceed from here on its own`)

step(6, 'the human approves in their wallet')
const decided = wallet.approve(approval.id)
console.log(`   ${decided.status} — intent and cart mandates signed`)

step(7, 'complete the purchase')
const paid = await client.post(`/api/checkout_sessions/${id}/complete`, {
  intent_mandate: decided.intent_jws,
  cart_mandate: decided.cart_jws,
})

if (!gateAllowed(paid.status)) {
  console.log(`   refused: ${paid.json?.error?.code} — ${paid.json?.error?.message}`)
  process.exit(1)
}

console.log(`   ${paid.json.status}${paid.status === 202 ? ' — awaiting the provider capture webhook' : ''}`)
console.log(`   payment ${paid.json.payment.reference} for ${formatInr(paid.json.payment.amount_paise)}`)

step(8, 'the gate checks that were evaluated')
for (const check of paid.json.checks) {
  console.log(`   ${check.passed ? '+' : 'x'} ${check.name}${check.detail ? `  (${check.detail})` : ''}`)
}

console.log(`\ntrail: /sessions/${id}`)
