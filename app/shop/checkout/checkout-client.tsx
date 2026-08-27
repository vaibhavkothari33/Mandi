'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { clearCart, formatInr, readCart, type CartLine } from '../cart'
import { ProductArt } from '../product-art'

interface Product {
  id: string
  title: string
  category: string
  price_paise: number
}

interface Totals {
  items_paise: number
  shipping_paise: number
  tax_paise: number
  total_paise: number
}

interface Quoted {
  sessionId: string
  claimToken: string
  totals: Totals
  expiresAt: number
}

interface Paid {
  sessionId: string
  reference: string
  amountPaise: number
  checks: number
}

const ADDRESS = {
  name: 'A Shopper',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  postal_code: '560025',
  country: 'IN',
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

export function CheckoutClient({ products }: { products: Product[] }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [address, setAddress] = useState(ADDRESS)
  const [quoted, setQuoted] = useState<Quoted | null>(null)
  const [paid, setPaid] = useState<Paid | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => setLines(readCart()), [])

  useEffect(() => {
    if (!quoted || paid) return
    const tick = () => setRemaining(Math.max(0, Math.round((quoted.expiresAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [quoted, paid])

  const byId = new Map(products.map((p) => [p.id, p]))
  const subtotal = lines.reduce(
    (sum, l) => sum + (byId.get(l.product_id)?.price_paise ?? 0) * l.quantity,
    0,
  )

  const lockPrice = useCallback(async () => {
    setBusy(true)
    setError(null)

    try {
      const created = await post('/api/shop/checkout', {
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        fulfillment: address,
      })

      if (created.status !== 201) {
        setError(created.json?.error?.message ?? 'could not open a checkout')
        return
      }

      const claimToken: string = created.json.claim_token
      const quote = await post(`/api/shop/${created.json.id}/quote`, { claim_token: claimToken })

      if (quote.status !== 201) {
        setError(quote.json?.error?.message ?? 'could not lock a price')
        return
      }

      setQuoted({
        sessionId: created.json.id,
        claimToken,
        totals: created.json.totals as Totals,
        expiresAt: Date.parse(quote.json.expires_at),
      })
    } finally {
      setBusy(false)
    }
  }, [lines, address])

  const pay = useCallback(async () => {
    if (!quoted) return
    setBusy(true)
    setError(null)

    try {
      const result = await post(`/api/shop/${quoted.sessionId}/pay`, {
        claim_token: quoted.claimToken,
      })

      if (result.status !== 200) {
        setError(result.json?.error?.message ?? 'the gate refused this payment')
        return
      }

      clearCart()
      setPaid({
        sessionId: result.json.id,
        reference: result.json.payment.reference,
        amountPaise: result.json.payment.amount_paise,
        checks: (result.json.checks as unknown[]).length,
      })
    } finally {
      setBusy(false)
    }
  }, [quoted])

  if (paid) {
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-6">
        <div className="text-lg font-medium">Paid {formatInr(paid.amountPaise)}</div>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          Razorpay reference <span className="font-mono text-xs">{paid.reference}</span>. All{' '}
          {paid.checks} gate checks passed — the same ones an agent purchase goes through.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/sessions/${paid.sessionId}`}
            className="px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium hover:opacity-90"
          >
            See every decision
          </Link>
          <Link
            href="/shop"
            className="px-4 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-white dark:hover:bg-neutral-900"
          >
            Keep shopping
          </Link>
        </div>
      </div>
    )
  }

  if (lines.length === 0) {
    return (
      <p className="text-neutral-500">
        Your cart is empty.{' '}
        <Link href="/shop" className="underline">
          Find something
        </Link>
        .
      </p>
    )
  }

  const expired = quoted !== null && remaining === 0

  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-10 items-start">
      <div>
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">Your cart</h2>
        <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
          {lines.map((line) => {
            const product = byId.get(line.product_id)
            return (
              <li key={line.product_id} className="py-3 flex items-center gap-4">
                <ProductArt
                  productId={line.product_id}
                  category={product?.category ?? 'grocery'}
                  className="w-12 h-12 rounded-md shrink-0"
                />
                <span className="flex-1">{product?.title ?? line.product_id}</span>
                <span className="text-sm text-neutral-500 tabular-nums">× {line.quantity}</span>
                <span className="tabular-nums w-24 text-right">
                  {formatInr((product?.price_paise ?? 0) * line.quantity)}
                </span>
              </li>
            )
          })}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Deliver to
        </h2>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {(
            [
              ['name', 'Name'],
              ['line1', 'Address'],
              ['city', 'City'],
              ['state', 'State'],
              ['postal_code', 'PIN code'],
              ['country', 'Country'],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="text-sm">
              <span className="block text-xs text-neutral-500 mb-1">{label}</span>
              <input
                value={address[field]}
                disabled={quoted !== null}
                onChange={(e) => setAddress({ ...address, [field]: e.target.value })}
                className="w-full px-3 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent disabled:opacity-60"
              />
            </label>
          ))}
        </div>
      </div>

      <aside className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 lg:sticky lg:top-6">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">Items</span>
            <span className="tabular-nums">{formatInr(quoted?.totals.items_paise ?? subtotal)}</span>
          </div>
          {quoted && (
            <>
              <div className="flex justify-between">
                <span className="text-neutral-500">Shipping</span>
                <span className="tabular-nums">{formatInr(quoted.totals.shipping_paise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">GST</span>
                <span className="tabular-nums">{formatInr(quoted.totals.tax_paise)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800 font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {quoted ? formatInr(quoted.totals.total_paise) : '—'}
            </span>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-700 dark:text-red-500">{error}</p>
        )}

        {!quoted ? (
          <button
            onClick={lockPrice}
            disabled={busy}
            className="mt-5 w-full px-4 py-2.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Locking price…' : 'Lock the price'}
          </button>
        ) : (
          <>
            <p className="mt-4 text-xs text-neutral-500">
              {expired
                ? 'This price has expired. Lock a fresh one to continue.'
                : `This price holds for ${remaining}s. After that the gate refuses it and you are re-quoted.`}
            </p>

            <button
              onClick={expired ? lockPrice : pay}
              disabled={busy}
              className="mt-3 w-full px-4 py-2.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : expired ? 'Lock a fresh price' : `Pay ${formatInr(quoted.totals.total_paise)}`}
            </button>

            <p className="mt-3 text-xs text-neutral-500">
              Clicking pay signs a mandate for this exact cart, then runs the same twelve checks an
              agent purchase runs.
            </p>
          </>
        )}
      </aside>
    </div>
  )
}
