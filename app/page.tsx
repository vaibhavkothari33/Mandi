import Link from 'next/link'
import { verifyChain } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { formatInr } from '@/lib/money'
import { WEB_BUYER } from '@/lib/human'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  status: string
  agent_id: string | null
  totals_json: string
}

export default async function Home() {
  const handle = db()

  const counts = handle
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM checkout_sessions) AS sessions,
         (SELECT COUNT(*) FROM payments WHERE status = 'captured') AS captured,
         (SELECT COUNT(*) FROM audit_log) AS entries,
         (SELECT COUNT(*) FROM audit_log WHERE decision = 'refuse') AS refusals,
         (SELECT COUNT(*) FROM attack_results) AS attacks,
         (SELECT COUNT(*) FROM attack_results WHERE refused = 1) AS held`,
    )
    .get() as Record<string, number>

  const chain = verifyChain()

  const recent = handle
    .prepare(
      `SELECT id, status, agent_id, totals_json FROM checkout_sessions
        WHERE status = 'completed' ORDER BY created_at DESC LIMIT 6`,
    )
    .all() as unknown as Row[]

  const stat = (label: string, value: string) => (
    <div key={label}>
      <div className="text-2xl tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500 mt-1">{label}</div>
    </div>
  )

  return (
    <main>
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16">
        <p className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-500 mb-4">
          Agentic commerce, merchant side
        </p>
        <h1 className="text-4xl sm:text-5xl font-medium tracking-tight max-w-2xl text-balance">
          A shop an AI can buy from, without being able to overspend.
        </h1>
        <p className="mt-6 text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl text-pretty">
          Browse it yourself, or let Claude do it for you. Either way the same twelve
          deterministic checks stand between a request and your money — and every one of them is
          written down.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/shop"
            className="px-5 py-2.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium hover:opacity-90"
          >
            Shop it yourself
          </Link>
          <Link
            href="/orders"
            className="px-5 py-2.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            See what the agent did
          </Link>
        </div>
      </section>

      <section className="border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
            Two buyers, one gate
          </h2>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6">
              <div className="text-sm font-medium">You, in the browser</div>
              <ol className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
                <li>1. Put things in a cart</li>
                <li>2. Enter an address</li>
                <li>3. See a price, locked for two minutes</li>
                <li>4. Click pay — you are present, so the click is the consent</li>
              </ol>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6">
              <div className="text-sm font-medium">Claude, through MCP</div>
              <ol className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
                <li>1. Reads the catalogue as structured data</li>
                <li>2. Builds a cart and locks a price</li>
                <li>3. Asks you for consent — and stops</li>
                <li>4. Spends a mandate you signed, and nothing else</li>
              </ol>
            </div>
          </div>

          <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400 max-w-3xl text-pretty">
            Both paths end in the same place. A browser purchase signs a mandate at the moment you
            click, so there is exactly one way to spend money here — and a human order and an agent
            order leave an identical audit trail.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
          {stat('Checkouts', String(counts.sessions))}
          {stat('Paid', String(counts.captured))}
          {stat('Audit entries', String(counts.entries))}
          {stat('Refusals recorded', String(counts.refusals))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <span className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800">
            Audit chain{' '}
            <span
              className={
                chain.ok ? 'text-emerald-700 dark:text-emerald-500' : 'text-red-700 dark:text-red-500'
              }
            >
              {chain.ok ? 'intact' : `broken at ${chain.brokenAt}`}
            </span>
          </span>
          <Link
            href="/attacks"
            className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Adversarial suite{' '}
            <span
              className={
                counts.attacks > 0 && counts.held === counts.attacks
                  ? 'text-emerald-700 dark:text-emerald-500'
                  : 'text-neutral-500'
              }
            >
              {counts.attacks === 0 ? 'not run' : `${counts.held}/${counts.attacks} refused`}
            </span>
          </Link>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
              Recent orders
            </h2>
            <Link href="/orders" className="text-sm text-neutral-500 hover:underline">
              all orders
            </Link>
          </div>

          <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
            {recent.map((row) => (
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
                  <span className="ml-auto tabular-nums text-sm shrink-0">
                    {formatInr((JSON.parse(row.totals_json) as { total_paise: number }).total_paise)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
