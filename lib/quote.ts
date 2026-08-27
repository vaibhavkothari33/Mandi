import { cartHash, getProduct, type CartItem } from './catalog.ts'
import { LIMITS } from './config.ts'
import { db, nowIso } from './db/client.ts'
import { ApiError } from './http.ts'
import { quoteId } from './ids.ts'
import type { Paise } from './money.ts'
import { priceCart } from './pricing.ts'

export interface QuoteRow {
  id: string
  session_id: string
  cart_hash: string
  total_paise: number
  currency: string
  issued_at: string
  expires_at: string
}

export interface PriceDrift {
  product_id: string
  approved_paise: Paise
  current_paise: Paise | null
  reason: 'price_changed' | 'withdrawn' | 'out_of_stock'
}

export function issue(session: {
  id: string
  items: CartItem[]
  totals: { total_paise: Paise }
}): QuoteRow {
  const now = Date.now()

  return db()
    .prepare(
      `INSERT INTO quotes (id, session_id, cart_hash, total_paise, currency, issued_at, expires_at)
       VALUES (?, ?, ?, ?, 'INR', ?, ?) RETURNING *`,
    )
    .get(
      quoteId(),
      session.id,
      cartHash(session.items),
      session.totals.total_paise,
      new Date(now).toISOString(),
      new Date(now + LIMITS.quote_ttl_seconds * 1000).toISOString(),
    ) as unknown as QuoteRow
}

export function byId(id: string): QuoteRow {
  const row = db().prepare('SELECT * FROM quotes WHERE id = ?').get(id) as QuoteRow | undefined
  if (!row) throw new ApiError(404, 'quote_not_found', `no such quote: ${id}`)
  return row
}

export const find = (id: string): QuoteRow | undefined =>
  db().prepare('SELECT * FROM quotes WHERE id = ?').get(id) as QuoteRow | undefined

export const isExpired = (quote: QuoteRow): boolean => Date.parse(quote.expires_at) < Date.now()

export const secondsRemaining = (quote: QuoteRow): number =>
  Math.max(0, Math.round((Date.parse(quote.expires_at) - Date.now()) / 1000))

/**
 * Compares the prices a buyer approved against the catalogue as it stands now.
 *
 * A cart mandate binds the prices shown at approval time. Between approval and
 * completion a human may take a minute to confirm, and in that window stock can
 * sell out or a price can move. Charging the approved amount anyway would mean
 * collecting consent for one transaction and executing a different one.
 */
export function detectDrift(items: CartItem[]): PriceDrift[] {
  const drift: PriceDrift[] = []

  for (const item of items) {
    const product = getProduct(item.product_id)

    if (!product) {
      drift.push({
        product_id: item.product_id,
        approved_paise: item.unit_price_paise,
        current_paise: null,
        reason: 'withdrawn',
      })
      continue
    }

    if (product.price_paise !== item.unit_price_paise) {
      drift.push({
        product_id: item.product_id,
        approved_paise: item.unit_price_paise,
        current_paise: product.price_paise,
        reason: 'price_changed',
      })
      continue
    }

    if (product.stock < item.quantity) {
      drift.push({
        product_id: item.product_id,
        approved_paise: item.unit_price_paise,
        current_paise: product.price_paise,
        reason: 'out_of_stock',
      })
    }
  }

  return drift
}

/** Recomputes the total at current catalogue prices. */
export function repriceTotal(items: CartItem[]): Paise {
  const repriced = items.map((item) => {
    const product = getProduct(item.product_id)
    return { ...item, unit_price_paise: product?.price_paise ?? item.unit_price_paise }
  })
  return priceCart(repriced).total_paise
}

export function serialize(quote: QuoteRow) {
  return {
    id: quote.id,
    session_id: quote.session_id,
    cart_hash: quote.cart_hash,
    total_paise: quote.total_paise,
    currency: quote.currency,
    issued_at: quote.issued_at,
    expires_at: quote.expires_at,
    expires_in_seconds: secondsRemaining(quote),
  }
}
