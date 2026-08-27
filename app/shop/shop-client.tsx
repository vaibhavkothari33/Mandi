'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addLine, formatInr, readCart, writeCart, type CartLine } from './cart'
import { ProductArt } from './product-art'

export interface ShopProduct {
  id: string
  title: string
  description: string
  category: string
  price_paise: number
  stock: number
}

export function ShopClient({ products }: { products: ShopProduct[] }) {
  const router = useRouter()
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)

  // The cart lives in the browser, so it can only be read after mount.
  useEffect(() => {
    setLines(readCart())
    setReady(true)
  }, [])

  const update = (productId: string, delta: number) => {
    const next = addLine(lines, productId, delta)
    setLines(next)
    writeCart(next)
  }

  const quantityOf = (productId: string) =>
    lines.find((l) => l.product_id === productId)?.quantity ?? 0

  const byId = new Map(products.map((p) => [p.id, p]))
  const subtotal = lines.reduce(
    (sum, l) => sum + (byId.get(l.product_id)?.price_paise ?? 0) * l.quantity,
    0,
  )
  const count = lines.reduce((sum, l) => sum + l.quantity, 0)

  const categories = [...new Set(products.map((p) => p.category))]

  return (
    <div className="pb-28">
      {categories.map((category) => (
        <section key={category} className="mb-12">
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide mb-4">
            {category}
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products
              .filter((p) => p.category === category)
              .map((product) => {
                const inCart = quantityOf(product.id)
                const soldOut = product.stock === 0

                return (
                  <div
                    key={product.id}
                    className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden flex flex-col"
                  >
                    <div className="relative">
                      <ProductArt
                        productId={product.id}
                        category={product.category}
                        className="w-full h-40 object-cover"
                      />
                      {soldOut && (
                        <div className="absolute inset-0 bg-white/70 dark:bg-neutral-950/70 grid place-items-center">
                          <span className="text-xs uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
                            sold out
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="p-5 flex flex-col flex-1">
                    <div className="font-medium">{product.title}</div>
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 flex-1">
                      {product.description}
                    </p>

                    <div className="mt-4 flex items-center justify-between">
                      <span className="tabular-nums">{formatInr(product.price_paise)}</span>

                      {soldOut ? (
                        <span className="text-xs text-neutral-500">unavailable</span>
                      ) : inCart === 0 ? (
                        <button
                          onClick={() => update(product.id, 1)}
                          className="px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        >
                          Add
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => update(product.id, -1)}
                            aria-label={`Remove one ${product.title}`}
                            className="w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                          >
                            −
                          </button>
                          <span className="tabular-nums text-sm w-4 text-center">{inCart}</span>
                          <button
                            onClick={() => update(product.id, 1)}
                            aria-label={`Add one ${product.title}`}
                            disabled={inCart >= product.stock}
                            className="w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </section>
      ))}

      {ready && count > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-950/90 backdrop-blur">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {count} item{count === 1 ? '' : 's'}
            </span>
            <span className="tabular-nums font-medium">{formatInr(subtotal)}</span>
            <span className="text-xs text-neutral-500 hidden sm:inline">
              before shipping and tax
            </span>

            <button
              onClick={() => router.push('/shop/checkout')}
              className="ml-auto px-5 py-2.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium hover:opacity-90"
            >
              Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
