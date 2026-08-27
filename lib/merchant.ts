import { getProduct } from './catalog.ts'
import { db } from './db/client.ts'
import { WEB_BUYER } from './human.ts'
import type { Paise } from './money.ts'

export interface Channel {
  revenue_paise: Paise
  orders: number
}

export interface TopProduct {
  product_id: string
  title: string
  units: number
  revenue_paise: Paise
}

export interface RecentOrder {
  session_id: string
  reference: string | null
  amount_paise: Paise
  status: string
  channel: 'human' | 'agent'
  at: string
}

export interface MerchantStats {
  revenue_paise: Paise
  orders: number
  average_order_paise: Paise
  human: Channel
  agent: Channel
  agent_share_bps: number
  refusals: number
  refusals_by_reason: Array<{ reason: string; count: number }>
  top_products: TopProduct[]
  recent: RecentOrder[]
  generated_at: string
}

interface PaidRow {
  session_id: string
  razorpay_payment_id: string | null
  amount_paise: number
  status: string
  created_at: string
  agent_id: string | null
  items_json: string
}

const channelOf = (agentId: string | null): 'human' | 'agent' =>
  agentId === WEB_BUYER ? 'human' : 'agent'

/**
 * What the merchant sees. Revenue counts captured payments only — an
 * authorised-but-unsettled payment is not money, and a dashboard that treats
 * it as money is the reason merchants distrust dashboards.
 */
export function stats(): MerchantStats {
  const handle = db()

  const paid = handle
    .prepare(
      `SELECT p.session_id, p.razorpay_payment_id, p.amount_paise, p.status, p.created_at,
              s.agent_id, s.items_json
         FROM payments p
         JOIN checkout_sessions s ON s.id = p.session_id
        WHERE p.status = 'captured'
        ORDER BY p.created_at DESC`,
    )
    .all() as unknown as PaidRow[]

  const empty = (): Channel => ({ revenue_paise: 0, orders: 0 })
  const human = empty()
  const agent = empty()
  const units = new Map<string, { units: number; revenue: number }>()

  for (const row of paid) {
    const bucket = channelOf(row.agent_id) === 'human' ? human : agent
    bucket.revenue_paise += row.amount_paise
    bucket.orders += 1

    const items = JSON.parse(row.items_json) as Array<{
      product_id: string
      quantity: number
      unit_price_paise: number
    }>

    for (const item of items) {
      const current = units.get(item.product_id) ?? { units: 0, revenue: 0 }
      current.units += item.quantity
      current.revenue += item.quantity * item.unit_price_paise
      units.set(item.product_id, current)
    }
  }

  const revenue = human.revenue_paise + agent.revenue_paise
  const orders = human.orders + agent.orders

  // node:sqlite returns rows with a null prototype, which React refuses to
  // serialise into a client component. Copy them into plain objects.
  const refusals = (
    handle
      .prepare(
        `SELECT reason, COUNT(*) AS count FROM audit_log
          WHERE decision = 'refuse' AND reason IS NOT NULL
          GROUP BY reason ORDER BY count DESC LIMIT 6`,
      )
      .all() as unknown as Array<{ reason: string; count: number }>
  ).map((row) => ({ reason: row.reason, count: row.count }))

  const refusalTotal = (
    handle.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE decision = 'refuse'").get() as {
      n: number
    }
  ).n

  const topProducts: TopProduct[] = [...units.entries()]
    .map(([product_id, v]) => ({
      product_id,
      title: getProduct(product_id)?.title ?? product_id,
      units: v.units,
      revenue_paise: v.revenue,
    }))
    .sort((a, b) => b.revenue_paise - a.revenue_paise)
    .slice(0, 5)

  return {
    revenue_paise: revenue,
    orders,
    average_order_paise: orders === 0 ? 0 : Math.round(revenue / orders),
    human,
    agent,
    agent_share_bps: revenue === 0 ? 0 : Math.round((agent.revenue_paise / revenue) * 10_000),
    refusals: refusalTotal,
    refusals_by_reason: refusals,
    top_products: topProducts,
    recent: paid.slice(0, 12).map((row) => ({
      session_id: row.session_id,
      reference: row.razorpay_payment_id,
      amount_paise: row.amount_paise,
      status: row.status,
      channel: channelOf(row.agent_id),
      at: row.created_at,
    })),
    generated_at: new Date().toISOString(),
  }
}
