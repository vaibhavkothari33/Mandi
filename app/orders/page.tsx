import Link from 'next/link'
import { db } from '@/lib/db/client'
import { WEB_BUYER } from '@/lib/human'
import { formatInr } from '@/lib/money'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  status: string
  agent_id: string | null
  totals_json: string
  created_at: string
}

const total = (row: Row) => (JSON.parse(row.totals_json) as { total_paise: number }).total_paise

function List({ rows }: { rows: Row[] }) {
  return (
    <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/sessions/${row.id}`} className="flex items-center gap-4 py-3 group">
            <span
              className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                row.agent_id === WEB_BUYER
                  ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-500'
              }`}
            >
              {row.agent_id === WEB_BUYER ? 'human' : 'agent'}
            </span>
            <span className="font-mono text-xs text-neutral-500 truncate group-hover:underline">
              {row.id}
            </span>
            <span className="text-xs text-neutral-500 shrink-0 hidden sm:inline">
              {row.status.replace(/_/g, ' ')}
            </span>
            <span className="ml-auto tabular-nums text-sm shrink-0">{formatInr(total(row))}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default async function OrdersPage() {
  const rows = db()
    .prepare(
      `SELECT id, status, agent_id, totals_json, created_at FROM checkout_sessions
        ORDER BY created_at DESC LIMIT 200`,
    )
    .all() as unknown as Row[]

  // A checkout that was never paid for is not an order. Keeping the two apart
  // is why this page and the landing page now agree on what "recent" means.
  const orders = rows.filter((r) => r.status === 'completed')
  const abandoned = rows.filter((r) => r.status !== 'completed')

  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Orders</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
        Every purchase that was actually paid for, however it was placed. Each one links to the
        decisions behind it.
      </p>

      {orders.length === 0 ? (
        <p className="mt-8 text-neutral-500">
          Nothing bought yet.{' '}
          <Link href="/shop" className="underline">
            Buy something
          </Link>
          , or run <code className="font-mono text-sm">npm run buyer</code>.
        </p>
      ) : (
        <>
          <div className="mt-8 flex items-baseline gap-3">
            <span className="text-sm text-neutral-500">
              {orders.length} order{orders.length === 1 ? '' : 's'}
            </span>
            <span className="text-sm text-neutral-500">
              · {formatInr(orders.reduce((sum, r) => sum + total(r), 0))} paid
            </span>
          </div>
          <List rows={orders} />
        </>
      )}

      {abandoned.length > 0 && (
        <section className="mt-14">
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
            Checkouts that never became orders
          </h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
            {abandoned.length} carts were opened and not paid for — abandoned, cancelled, or
            refused by the gate. They are listed because a merchant should be able to see them,
            but none of them is revenue.
          </p>
          <List rows={abandoned} />
        </section>
      )}
    </main>
  )
}
