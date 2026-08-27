import { listProducts } from '@/lib/catalog'
import { ShopClient, type ShopProduct } from './shop-client'

export const dynamic = 'force-dynamic'

export default async function ShopPage() {
  const products: ShopProduct[] = listProducts().map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    price_paise: p.price_paise,
    stock: p.stock,
  }))

  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Mandi Provisions</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
        The same catalogue an agent reads at{' '}
        <a href="/api/catalog" className="underline">
          /api/catalog
        </a>
        . Prices here are the prices it sees, because the server is the only thing that sets them.
      </p>

      <div className="mt-10">
        <ShopClient products={products} />
      </div>
    </main>
  )
}
