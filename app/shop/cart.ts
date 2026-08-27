'use client'

export interface CartLine {
  product_id: string
  quantity: number
}

const KEY = 'mandi.cart'

/** Storage can throw in private windows, so every access degrades to an empty cart. */
export function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CartLine[]
    return Array.isArray(parsed) ? parsed.filter((l) => l.product_id && l.quantity > 0) : []
  } catch {
    return []
  }
}

/** The nav badge lives outside React's tree, so cart writes announce themselves. */
export const CART_CHANGED = 'mandi:cart'

const announce = () => window.dispatchEvent(new CustomEvent(CART_CHANGED))

export function writeCart(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines))
  } catch {
    // A cart that cannot persist is still usable for this page view.
  }
  announce()
}

export function clearCart(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
  announce()
}

export const cartCount = (lines: CartLine[]): number =>
  lines.reduce((sum, line) => sum + line.quantity, 0)

export function addLine(lines: CartLine[], productId: string, delta = 1): CartLine[] {
  const next = lines.map((l) =>
    l.product_id === productId ? { ...l, quantity: l.quantity + delta } : l,
  )

  if (!next.some((l) => l.product_id === productId)) {
    next.push({ product_id: productId, quantity: Math.max(1, delta) })
  }

  return next.filter((l) => l.quantity > 0)
}

export const formatInr = (paise: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
    .format(paise / 100)
