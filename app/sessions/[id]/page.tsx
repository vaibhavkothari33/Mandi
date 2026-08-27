import Link from 'next/link'
import { notFound } from 'next/navigation'
import { forSession } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { formatInr } from '@/lib/money'
import { forSession as paymentsForSession } from '@/lib/pay/store'

export const dynamic = 'force-dynamic'

interface Check {
  name: string
  passed: boolean
  detail?: string
}

export default async function SessionPage({ params }: PageProps<'/sessions/[id]'>) {
  const { id } = await params

  const session = db()
    .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
    .get(id) as { id: string; status: string; totals_json: string; agent_id: string | null } | undefined

  if (!session) notFound()

  const trail = forSession(id)
  const payments = paymentsForSession(id)
  const totals = JSON.parse(session.totals_json) as { total_paise: number }

  return (
    <main className="max-w-4xl mx-auto p-8 font-mono text-sm">
      <Link href="/" className="text-neutral-500 underline">
        back
      </Link>

      <h1 className="text-lg mt-4 break-all">{session.id}</h1>
      <p className="text-neutral-500 mb-6">
        {session.status} · {formatInr(totals.total_paise)} · {session.agent_id ?? 'no agent'}
      </p>

      {payments.length > 0 && (
        <div className="border border-neutral-300 dark:border-neutral-700 p-4 mb-6">
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span className="text-neutral-500">{p.razorpay_payment_id ?? p.id}</span>
              <span>
                {formatInr(p.amount_paise)} · {p.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-neutral-500">Audit trail</h2>
      <div className="space-y-3">
        {trail.map((entry) => {
          const detail = JSON.parse(entry.detail_json) as { checks?: Check[]; reference?: string }
          const tone =
            entry.decision === 'allow'
              ? 'text-green-700 dark:text-green-500'
              : entry.decision === 'refuse'
                ? 'text-red-700 dark:text-red-500'
                : 'text-neutral-500'

          return (
            <div key={entry.seq} className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="flex justify-between gap-4">
                <span>
                  <span className="text-neutral-400">#{entry.seq}</span> {entry.action}
                </span>
                <span className={tone}>
                  {entry.decision}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
              </div>

              {detail.checks && (
                <ul className="mt-2 ml-4 space-y-0.5">
                  {detail.checks.map((c) => (
                    <li key={c.name} className={c.passed ? 'text-neutral-500' : 'text-red-700 dark:text-red-500'}>
                      {c.passed ? '+' : 'x'} {c.name}
                      {c.detail ? <span className="text-neutral-400"> — {c.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-1 text-xs text-neutral-400 break-all">
                hash {entry.hash.slice(0, 24)} · prev {entry.prev_hash?.slice(0, 12) ?? 'genesis'}
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
