import { db, nowIso } from './db/client.ts'
import { hashOf } from './canonical.ts'
import type { Paise } from './money.ts'

export interface Product {
  id: string
  title: string
  description: string
  category: string
  price_paise: Paise
  currency: string
  stock: number
  updated_at: string
}

export interface CartItem {
  product_id: string
  quantity: number
  unit_price_paise: Paise
}

export const listProducts = (): Product[] =>
  db().prepare('SELECT * FROM products ORDER BY id').all() as unknown as Product[]

export const getProduct = (id: string): Product | undefined =>
  db().prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined

export function setPrice(id: string, pricePaise: Paise): void {
  db()
    .prepare('UPDATE products SET price_paise = ?, updated_at = ? WHERE id = ?')
    .run(pricePaise, nowIso(), id)
}

export function setStock(id: string, stock: number): void {
  db().prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stock, nowIso(), id)
}

/**
 * Binds a mandate to exact contents: product, quantity and the unit price the
 * buyer was shown. Any later mutation produces a different hash.
 */
export const cartHash = (items: CartItem[], currency = 'INR'): string =>
  hashOf({
    currency,
    items: [...items]
      .sort((a, b) => (a.product_id < b.product_id ? -1 : 1))
      .map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price_paise: i.unit_price_paise,
      })),
  })

export const cartTotal = (items: CartItem[]): Paise =>
  items.reduce((sum, i) => sum + i.unit_price_paise * i.quantity, 0)
