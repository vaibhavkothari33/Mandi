import { stats } from '@/lib/merchant'
import { MerchantClient } from './merchant-client'

export const dynamic = 'force-dynamic'

export default async function MerchantPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Merchant</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
        What the shopkeeper sees. Revenue counts captured payments only, and updates as orders
        land — whoever placed them.
      </p>

      <div className="mt-10">
        <MerchantClient initial={stats()} />
      </div>
    </main>
  )
}
