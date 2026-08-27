import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { AgentClient, ADDRESS } from '../harness/client.ts'
import { formatInr } from '../lib/money.ts'
import * as wallet from '../lib/wallet.ts'

/**
 * Buyer-side tools for an AI shopper.
 *
 * There is deliberately no tool here that signs a mandate. The agent can ask
 * for consent and can spend consent that already exists, but it cannot create
 * it: approval happens out of band, in `npm run approve`, standing in for a
 * wallet app on the buyer's own device.
 */
const client = new AgentClient()
const server = new McpServer({ name: 'mandi-buyer', version: '0.1.0' })

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

server.registerTool(
  'search_catalog',
  {
    title: 'Search the merchant catalogue',
    description: 'List products the merchant sells, optionally filtered by category or text.',
    inputSchema: {
      query: z.string().optional().describe('Text to match against title or description'),
      category: z.string().optional().describe('Restrict to one category, e.g. grocery'),
    },
  },
  async ({ query, category }) => {
    const reply = await client.get('/api/catalog')
    const needle = query?.toLowerCase()

    const items = (reply.json.items as any[])
      .filter((i) => !category || i.category === category)
      .filter((i) => !needle || `${i.title} ${i.description}`.toLowerCase().includes(needle))

    if (items.length === 0) return text('No matching products.')

    return text(
      items
        .map(
          (i) =>
            `${i.id}  ${i.title}  ${formatInr(i.price.amount_paise)}  ${i.category}  ${i.availability}`,
        )
        .join('\n'),
    )
  },
)

server.registerTool(
  'start_checkout',
  {
    title: 'Open a checkout session',
    description:
      'Create a checkout session for the given products. Prices are set by the merchant, not by the caller.',
    inputSchema: {
      items: z
        .array(z.object({ product_id: z.string(), quantity: z.number().int().min(1) }))
        .min(1)
        .describe('Products and quantities to buy'),
    },
  },
  async ({ items }) => {
    const reply = await client.post('/api/checkout_sessions', { items, fulfillment: ADDRESS })

    if (reply.status !== 201) {
      return text(`Refused: ${reply.json?.error?.code} — ${reply.json?.error?.message}`)
    }

    const lines = (reply.json.line_items as any[])
      .map((l) => `  ${l.quantity} x ${l.title} @ ${formatInr(l.unit_price_paise)}`)
      .join('\n')

    return text(
      [
        `session ${reply.json.id} (${reply.json.status})`,
        lines,
        `  items ${formatInr(reply.json.totals.items_paise)}`,
        `  shipping ${formatInr(reply.json.totals.shipping_paise)}`,
        `  tax ${formatInr(reply.json.totals.tax_paise)}`,
        `  total ${formatInr(reply.json.totals.total_paise)}`,
      ].join('\n'),
    )
  },
)

server.registerTool(
  'get_quote',
  {
    title: 'Lock the price',
    description:
      'Request a time-limited quote for a session. A quote must exist before approval can be requested.',
    inputSchema: { session_id: z.string() },
  },
  async ({ session_id }) => {
    const reply = await client.post(`/api/checkout_sessions/${session_id}/quote`, {})

    if (reply.status !== 201) {
      return text(`Refused: ${reply.json?.error?.code} — ${reply.json?.error?.message}`)
    }

    return text(
      `quote ${reply.json.id} for ${formatInr(reply.json.total_paise)}, valid ${reply.json.expires_in_seconds}s`,
    )
  },
)

server.registerTool(
  'request_approval',
  {
    title: 'Ask the human to approve this purchase',
    description:
      'Ask for consent to spend. This creates a pending request only. You cannot approve it yourself, and you cannot complete a purchase until a human decides it.',
    inputSchema: { session_id: z.string() },
  },
  async ({ session_id }) => {
    try {
      const approval = wallet.request(session_id, client.agentId)

      return text(
        [
          `approval ${approval.id} is pending`,
          `  ${approval.summary}`,
          `  total ${formatInr(approval.amount_paise)}`,
          '',
          'The human approves in their own wallet:',
          `  npm run approve -- ${approval.id}`,
          '',
          'Poll check_approval until it reports approved, then call complete_purchase.',
        ].join('\n'),
      )
    } catch (err) {
      return text(`Cannot request approval: ${(err as Error).message}`)
    }
  },
)

server.registerTool(
  'check_approval',
  {
    title: 'Check whether the human has decided',
    description: 'Report the status of an approval request: pending, approved or denied.',
    inputSchema: { approval_id: z.string() },
  },
  async ({ approval_id }) => {
    const approval = wallet.find(approval_id)
    if (!approval) return text(`No such approval: ${approval_id}`)

    if (approval.status === 'pending') return text('pending — still waiting on the human')
    if (approval.status === 'denied') return text('denied — the human declined. Do not retry.')

    return text(`approved — call complete_purchase with session ${approval.session_id}`)
  },
)

server.registerTool(
  'complete_purchase',
  {
    title: 'Complete an approved purchase',
    description:
      'Spend an approval that a human already granted. Fails if the approval is missing, pending, denied, expired, or if anything about the cart or price has changed since it was granted.',
    inputSchema: { session_id: z.string(), approval_id: z.string() },
  },
  async ({ session_id, approval_id }) => {
    const approval = wallet.find(approval_id)
    if (!approval) return text(`No such approval: ${approval_id}`)
    if (approval.status !== 'approved') return text(`Approval is ${approval.status}, not approved.`)
    if (approval.session_id !== session_id) return text('That approval belongs to a different session.')

    const reply = await client.post(`/api/checkout_sessions/${session_id}/complete`, {
      intent_mandate: approval.intent_jws,
      cart_mandate: approval.cart_jws,
    })

    if (reply.status !== 200) {
      const failed = (reply.json?.checks as any[])?.filter((c) => !c.passed) ?? []
      return text(
        [
          `The gate refused: ${reply.json?.error?.code}`,
          `  ${reply.json?.error?.message}`,
          ...failed.map((c) => `  failed check: ${c.name}`),
        ].join('\n'),
      )
    }

    return text(
      [
        `Purchase complete. Session ${reply.json.id} is ${reply.json.status}.`,
        `  payment ${reply.json.payment.reference} for ${formatInr(reply.json.payment.amount_paise)}`,
        `  ${(reply.json.checks as any[]).length} gate checks passed`,
      ].join('\n'),
    )
  },
)

await server.connect(new StdioServerTransport())
