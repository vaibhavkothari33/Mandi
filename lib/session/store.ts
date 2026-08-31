import { db, nowIso } from '../db/client.ts'
import { getProduct, type CartItem } from '../catalog.ts'
import { priceCart, type Totals } from '../pricing.ts'
import { LIMITS, MERCHANT } from '../config.ts'
import { ApiError } from '../http.ts'
import { sessionId } from '../ids.ts'
import {
  canTransition,
  deriveStatus,
  isLocked,
  isTerminal,
  type Fulfillment,
  type SessionStatus,
} from './machine.ts'

export interface SessionRow {
  id: string
  status: SessionStatus
  agent_id: string | null
  intent_mandate_id: string | null
  items_json: string
  fulfillment_json: string | null
  totals_json: string | null
  quote_id: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface Session {
  id: string
  status: SessionStatus
  agentId: string | null
  intentMandateId: string | null
  items: CartItem[]
  fulfillment: Fulfillment | null
  totals: Totals
  quoteId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

export interface ItemInput {
  product_id: string
  quantity: number
}

/**
 * Prices are resolved from the catalog, never accepted from the caller.
 * A buyer agent may choose what to buy; it may not assert what it costs.
 */
export function resolveItems(input: unknown): CartItem[] {
  if (!Array.isArray(input)) throw new ApiError(400, 'invalid_items', 'items must be an array', 'items')
  if (input.length > LIMITS.max_items_per_cart) {
    throw new ApiError(400, 'too_many_items', `at most ${LIMITS.max_items_per_cart} line items`, 'items')
  }

  const merged = new Map<string, number>()
  for (const raw of input as ItemInput[]) {
    const id = raw?.product_id
    const qty = raw?.quantity
    if (typeof id !== 'string' || !id) {
      throw new ApiError(400, 'invalid_item', 'product_id is required', 'items.product_id')
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.max_quantity_per_item) {
      throw new ApiError(
        400,
        'invalid_quantity',
        `quantity must be an integer between 1 and ${LIMITS.max_quantity_per_item}`,
        'items.quantity',
      )
    }
    merged.set(id, (merged.get(id) ?? 0) + qty)
  }

  return [...merged.entries()].map(([product_id, quantity]) => {
    const product = getProduct(product_id)
    if (!product) throw new ApiError(404, 'unknown_product', `no such product: ${product_id}`, 'items.product_id')
    if (product.stock < quantity) {
      throw new ApiError(409, 'insufficient_stock', `${product_id} has ${product.stock} in stock`, 'items.quantity')
    }
    return { product_id, quantity, unit_price_paise: product.price_paise }
  })
}

function hydrate(row: SessionRow): Session {
  const items = JSON.parse(row.items_json) as CartItem[]
  return {
    id: row.id,
    status: row.status,
    agentId: row.agent_id,
    intentMandateId: row.intent_mandate_id,
    items,
    fulfillment: row.fulfillment_json ? (JSON.parse(row.fulfillment_json) as Fulfillment) : null,
    totals: row.totals_json ? (JSON.parse(row.totals_json) as Totals) : priceCart(items),
    quoteId: row.quote_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

export function get(id: string): Session {
  const row = db().prepare('SELECT * FROM checkout_sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined
  if (!row) throw new ApiError(404, 'session_not_found', `no such checkout session: ${id}`)
  return hydrate(row)
}

export function create(opts: {
  agentId: string | null
  items: CartItem[]
  fulfillment: Fulfillment | null
}): Session {
  const id = sessionId()
  const at = nowIso()
  const status = deriveStatus('not_ready_for_payment', opts.items, opts.fulfillment)
  const totals = priceCart(opts.items)

  db()
    .prepare(
      `INSERT INTO checkout_sessions
         (id, status, agent_id, items_json, fulfillment_json, totals_json, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      id,
      status,
      opts.agentId,
      JSON.stringify(opts.items),
      opts.fulfillment ? JSON.stringify(opts.fulfillment) : null,
      JSON.stringify(totals),
      at,
      at,
    )

  return get(id)
}

/**
 * Optimistic concurrency: the update only lands if the row is still at the
 * version the caller read. A losing writer sees zero affected rows and is
 * rejected rather than silently overwriting.
 */
export function update(
  id: string,
  expectedVersion: number,
  patch: { items?: CartItem[]; fulfillment?: Fulfillment | null; status?: SessionStatus; quoteId?: string | null },
): Session {
  const current = get(id)
  if (isTerminal(current.status)) {
    throw new ApiError(409, 'session_terminal', `session is ${current.status} and cannot be modified`)
  }

  // A charge in flight freezes the cart. Only the status itself may still move,
  // and only along an edge the machine allows.
  const editsCart = patch.items !== undefined || patch.fulfillment !== undefined
  if (isLocked(current.status) && editsCart) {
    throw new ApiError(409, 'session_locked', `session is ${current.status} and cannot be modified`)
  }

  const items = patch.items ?? current.items
  const fulfillment = patch.fulfillment === undefined ? current.fulfillment : patch.fulfillment
  const status = patch.status ?? deriveStatus(current.status, items, fulfillment)

  if (!canTransition(current.status, status)) {
    throw new ApiError(
      409,
      'invalid_transition',
      `a session cannot move from ${current.status} to ${status}`,
    )
  }

  const totals = priceCart(items)
  const quoteId = patch.quoteId === undefined ? current.quoteId : patch.quoteId

  const result = db()
    .prepare(
      `UPDATE checkout_sessions
          SET items_json = ?, fulfillment_json = ?, totals_json = ?, status = ?,
              quote_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?`,
    )
    .run(
      JSON.stringify(items),
      fulfillment ? JSON.stringify(fulfillment) : null,
      JSON.stringify(totals),
      status,
      quoteId,
      nowIso(),
      id,
      expectedVersion,
    )

  if (result.changes === 0) {
    throw new ApiError(409, 'version_conflict', 'session was modified concurrently; re-read and retry')
  }

  return get(id)
}

export function serialize(session: Session) {
  const lineItems = session.items.map((i) => {
    const product = getProduct(i.product_id)
    return {
      product_id: i.product_id,
      title: product?.title ?? i.product_id,
      quantity: i.quantity,
      unit_price_paise: i.unit_price_paise,
      subtotal_paise: i.unit_price_paise * i.quantity,
    }
  })

  return {
    id: session.id,
    status: session.status,
    currency: MERCHANT.currency,
    merchant_id: MERCHANT.id,
    line_items: lineItems,
    fulfillment: session.fulfillment,
    totals: session.totals,
    quote_id: session.quoteId,
    version: session.version,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}
