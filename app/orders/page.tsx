import Link from 'next/link'
import { db } from '@/lib/db/client'
import { formatInr } from '@/lib/money'
import { WEB_BUYER } from '@/lib/human'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  status: string
  agent_id: string | null
  totals_json: string
  created_at: string
}

export default async function OrdersPage() {
  const rows = db()
    .prepare(
      'SELECT id, status, agent_id, totals_json, created_at FROM checkout_sessions ORDER BY created_at DESC LIMIT 60',
    )
    .all() as unknown as Row[]

  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Orders</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Every checkout, however it was opened. Each one links to the decisions that produced it.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-neutral-500">
          Nothing yet. <Link href="/shop" className="underline">Buy something</Link>, or run{' '}
          <code className="font-mono text-sm">npm run buyer</code>.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-neutral-200 dark:divide-neutral-800">
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
                <span className="text-xs text-neutral-500 shrink-0">{row.status}</span>
                <span className="ml-auto tabular-nums text-sm shrink-0">
                  {formatInr((JSON.parse(row.totals_json) as { total_paise: number }).total_paise)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
