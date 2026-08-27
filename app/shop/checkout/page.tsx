import Link from 'next/link'
import { listProducts } from '@/lib/catalog'
import { CheckoutClient } from './checkout-client'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const products = listProducts().map((p) => ({
    id: p.id,
    title: p.title,
    price_paise: p.price_paise,
  }))

  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <Link href="/shop" className="text-sm text-neutral-500 hover:underline">
        back to the shop
      </Link>

      <h1 className="mt-4 text-2xl font-medium tracking-tight">Checkout</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
        You are present, so your click is the consent — but it is still written down as a signed
        mandate, and it still has to clear the gate.
      </p>

      <div className="mt-10">
        <CheckoutClient products={products} />
      </div>
    </main>
  )
}
