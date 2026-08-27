import { listProducts } from '@/lib/catalog'
import { LIMITS, MERCHANT, PROTOCOL } from '@/lib/config'
import { nowIso } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const products = listProducts()

  return Response.json({
    protocol: PROTOCOL.checkout,
    merchant_id: MERCHANT.id,
    currency: MERCHANT.currency,
    generated_at: nowIso(),
    price_ttl_seconds: LIMITS.quote_ttl_seconds,
    items: products.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      price: { amount_paise: p.price_paise, currency: p.currency },
      availability: p.stock > 0 ? 'in_stock' : 'out_of_stock',
      stock: p.stock,
    })),
  })
}
