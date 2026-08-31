import { cartHash, setPrice, setStock } from '../lib/catalog.ts'
import { gateAllowed } from '../lib/http.ts'
import { db } from '../lib/db/client.ts'
import { issueCart } from '../lib/mandate/issue.ts'
import * as mandates from '../lib/mandate/store.ts'
import { forSession as paymentsForSession } from '../lib/pay/store.ts'
import * as wallet from '../lib/wallet.ts'
import { ADDRESS, AgentClient } from './client.ts'

export interface AttackOutcome {
  refused: boolean
  code: string
  detail: string
  /**
   * The attack never got far enough to be judged. Reported separately because
   * a suite that cannot set itself up has proved nothing, and calling that a
   * breach cries wolf on the one signal that must stay trustworthy.
   */
  setupFailed?: boolean
}

export interface Attack {
  id: number
  name: string
  premise: string
  expected: string
  run: (client: AgentClient) => Promise<AttackOutcome>
}

const SUBJECT = 'user_demo'

/** A session that has been quoted and approved by a human, ready to complete. */
async function approved(
  client: AgentClient,
  opts: { product?: string; quantity?: number; scope?: Parameters<typeof wallet.approve>[1] } = {},
) {
  const product = opts.product ?? 'sku_chai_250'
  const quantity = opts.quantity ?? 1

  const session = await client.post('/api/checkout_sessions', {
    items: [{ product_id: product, quantity }],
    fulfillment: ADDRESS,
  })
  const id = session.json.id as string

  const quote = await client.post(`/api/checkout_sessions/${id}/quote`, {})
  const request = wallet.request(id, client.agentId)
  const decided = wallet.approve(request.id, opts.scope)

  return { id, quote: quote.json, approval: decided, totals: session.json.totals }
}

const complete = (client: AgentClient, id: string, intent: string | null, cart: string | null) =>
  client.post(`/api/checkout_sessions/${id}/complete`, {
    intent_mandate: intent,
    cart_mandate: cart,
  })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Some attacks need a completed purchase before they can begin. Against real
 * Razorpay test keys that step can be throttled, which is a property of the
 * provider rather than of the gate, so it is retried before giving up.
 */
async function completeForSetup(
  client: AgentClient,
  id: string,
  intent: string | null,
  cart: string | null,
): Promise<{ ok: boolean; detail: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await complete(client, id, intent, cart)
    if (gateAllowed(reply.status)) return { ok: true, detail: '' }

    const code = reply.json?.error?.code ?? `http_${reply.status}`
    const transient = code === 'payment_failed' || code === 'payment_indeterminate'
    if (!transient) return { ok: false, detail: code }

    if (attempt < 2) await sleep(1500 * (attempt + 1))
    else return { ok: false, detail: `${code}: ${reply.json?.error?.message ?? ''}`.trim() }
  }

  return { ok: false, detail: 'unreachable' }
}

const outcome = (reply: { status: number; json: any }): AttackOutcome => ({
  refused: !gateAllowed(reply.status),
  code: reply.json?.error?.code ?? (gateAllowed(reply.status) ? 'ALLOWED' : `http_${reply.status}`),
  detail: reply.json?.error?.message ?? '',
})

export const ATTACKS: Attack[] = [
  {
    id: 1,
    name: 'Spend beyond the granted limit',
    premise: 'The human authorised ₹100. The agent presents a cart worth far more.',
    expected: 'scope_amount_exceeded',
    run: async (client) => {
      const s = await approved(client, { quantity: 4, scope: { maxAmountPaise: 10000 } })
      return outcome(await complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws))
    },
  },
  {
    id: 2,
    name: 'Replay a mandate that was already spent',
    premise: 'The agent keeps a copy of a used cart mandate and presents it again.',
    expected: 'mandate_already_used',
    run: async (client) => {
      const s = await approved(client)
      const first = await completeForSetup(client, s.id, s.approval.intent_jws, s.approval.cart_jws)
      if (!first.ok) {
        return { refused: false, setupFailed: true, code: 'setup_failed', detail: first.detail }
      }

      // A fresh session, but the old mandate replayed against it.
      const next = await approved(client)
      return outcome(await complete(client, next.id, s.approval.intent_jws, s.approval.cart_jws))
    },
  },
  {
    id: 3,
    name: 'Enlarge the cart after approval',
    premise: 'The human approved one unit. The agent quietly changes it to nine.',
    expected: 'quote_superseded',
    run: async (client) => {
      const s = await approved(client)
      await client.post(`/api/checkout_sessions/${s.id}`, {
        items: [{ product_id: 'sku_chai_250', quantity: 9 }],
      })
      return outcome(await complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws))
    },
  },
  {
    id: 4,
    name: 'Use an expired mandate',
    premise: 'The agent waits, then presents consent that has aged out.',
    expected: 'mandate_expired',
    run: async (client) => {
      const s = await approved(client)
      db()
        .prepare("UPDATE mandates SET expires_at = ? WHERE id = (SELECT id FROM mandates WHERE kind = 'cart' ORDER BY issued_at DESC LIMIT 1)")
        .run(new Date(Date.now() - 60_000).toISOString())

      // The stored row is only bookkeeping; the signed exp is what is checked.
      const stale = issueCart({
        subject: SUBJECT,
        agent: client.agentId,
        intentJti: JSON.parse(Buffer.from(s.approval.intent_jws!.split('.')[1], 'base64url').toString()).jti,
        sessionId: s.id,
        quoteId: s.quote.id,
        cartHash: cartHash([{ product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }]),
        amountPaise: s.totals.total_paise,
        ttlSeconds: -30,
      })

      return outcome(await complete(client, s.id, s.approval.intent_jws, stale.jws))
    },
  },
  {
    id: 5,
    name: 'Reprice between approval and completion',
    premise: 'The cart is untouched, but the merchant moves the price while the human decides.',
    expected: 'quote_price_drift',
    run: async (client) => {
      const s = await approved(client, { product: 'sku_honey_500' })
      setPrice('sku_honey_500', 61500)

      const result = outcome(await complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws))
      setPrice('sku_honey_500', 47500)
      return result
    },
  },
  {
    id: 6,
    name: 'Buy outside the authorised category',
    premise: 'Consent covered groceries. The agent puts kitchenware in the cart.',
    expected: 'scope_category',
    run: async (client) => {
      const s = await approved(client, {
        product: 'sku_press_french',
        scope: { maxAmountPaise: 10_000_000, categories: ['grocery'] },
      })
      return outcome(await complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws))
    },
  },
  {
    id: 7,
    name: 'Forge the approved amount',
    premise: 'The agent mints a cart mandate for ₹1 against a real, more expensive cart.',
    expected: 'amount_mismatch',
    run: async (client) => {
      const s = await approved(client)
      const intent = JSON.parse(
        Buffer.from(s.approval.intent_jws!.split('.')[1], 'base64url').toString(),
      )

      const forged = issueCart({
        subject: SUBJECT,
        agent: client.agentId,
        intentJti: intent.jti,
        sessionId: s.id,
        quoteId: s.quote.id,
        cartHash: cartHash([{ product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }]),
        amountPaise: 100,
      })

      return outcome(await complete(client, s.id, s.approval.intent_jws, forged.jws))
    },
  },
  {
    id: 8,
    name: 'Race two completions at once',
    premise: 'Two identical requests are fired simultaneously, hoping both are charged.',
    expected: 'exactly one charge',
    run: async (client) => {
      const s = await approved(client)

      const [a, b] = await Promise.all([
        complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws),
        complete(client, s.id, s.approval.intent_jws, s.approval.cart_jws),
      ])

      const succeeded = [a, b].filter((r) => gateAllowed(r.status)).length
      const live = paymentsForSession(s.id).filter((p) => p.status !== 'failed').length
      const loser = [a, b].find((r) => !gateAllowed(r.status))
      const detail = `${succeeded} of 2 completed, ${live} live payment(s)`

      // Only more than one is a breach. Zero means neither request got through,
      // which says nothing about the race and must not be reported as a charge.
      if (succeeded > 1 || live > 1) {
        return { refused: false, code: 'DOUBLE_CHARGE', detail }
      }

      if (succeeded === 0) {
        return {
          refused: false,
          setupFailed: true,
          code: 'setup_failed',
          detail: `${detail}; neither completion succeeded (${loser?.json?.error?.code ?? 'unknown'})`,
        }
      }

      return { refused: true, code: loser?.json?.error?.code ?? 'refused', detail }
    },
  },
]

export function resetCatalog(): void {
  setPrice('sku_honey_500', 47500)
  setStock('sku_honey_500', 18)
}

export { mandates }
