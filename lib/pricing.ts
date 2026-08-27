import type { Paise } from './money.ts'
import type { CartItem } from './catalog.ts'

export const GST_BPS = 500
export const SHIPPING_FLAT_PAISE = 4000
export const FREE_SHIPPING_THRESHOLD_PAISE = 50000

export interface Totals {
  items_paise: Paise
  shipping_paise: Paise
  tax_paise: Paise
  total_paise: Paise
}

/** GST is rounded once at order level, not per line, to keep totals reconcilable. */
export function priceCart(items: CartItem[]): Totals {
  const items_paise = items.reduce((sum, i) => sum + i.unit_price_paise * i.quantity, 0)
  const shipping_paise =
    items_paise === 0 || items_paise >= FREE_SHIPPING_THRESHOLD_PAISE ? 0 : SHIPPING_FLAT_PAISE
  const tax_paise = Math.round((items_paise * GST_BPS) / 10_000)

  return {
    items_paise,
    shipping_paise,
    tax_paise,
    total_paise: items_paise + shipping_paise + tax_paise,
  }
}
