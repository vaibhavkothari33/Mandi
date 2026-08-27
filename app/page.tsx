import Link from 'next/link'
import { verifyChain } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { formatInr } from '@/lib/money'

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  status: string
  totals_json: string
  created_at: string
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
         (SELECT COUNT(*) FROM attack_results WHERE refused = 1) AS attacksHeld`,
    )
    .get() as Record<string, number>

  const chain = verifyChain()

  const sessions = handle
    .prepare('SELECT id, status, totals_json, created_at FROM checkout_sessions ORDER BY created_at DESC LIMIT 15')
    .all() as unknown as SessionRow[]

  const stat = (label: string, value: string) => (
    <div key={label} className="border border-neutral-300 dark:border-neutral-700 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl mt-1 tabular-nums">{value}</div>
    </div>
  )

  return (
    <main className="max-w-4xl mx-auto p-8 font-mono text-sm">
      <h1 className="text-xl mb-1">Mandi</h1>
      <p className="text-neutral-500 mb-8">Agentic commerce surface for a Razorpay merchant.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {stat('Sessions', String(counts.sessions))}
        {stat('Captured', String(counts.captured))}
        {stat('Audit entries', String(counts.entries))}
        {stat('Refusals', String(counts.refusals))}
      </div>

      <div className="border border-neutral-300 dark:border-neutral-700 p-4 mb-8">
        <div className="flex justify-between">
          <span>Audit chain</span>
          <span className={chain.ok ? 'text-green-700 dark:text-green-500' : 'text-red-700 dark:text-red-500'}>
            {chain.ok ? 'intact' : `broken at entry ${chain.brokenAt}`}
          </span>
        </div>
        <div className="flex justify-between mt-2">
          <span>
            Adversarial suite{' '}
            <Link href="/attacks" className="underline text-neutral-500">
              view
            </Link>
          </span>
          <span className={counts.attacks > 0 && counts.attacksHeld === counts.attacks ? 'text-green-700 dark:text-green-500' : 'text-neutral-500'}>
            {counts.attacks === 0 ? 'not run' : `${counts.attacksHeld} of ${counts.attacks} refused`}
          </span>
        </div>
      </div>

      <h2 className="mb-3 text-neutral-500">Recent sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-neutral-500">None yet. Run `npm run buyer`.</p>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-2">
                  <Link href={`/sessions/${s.id}`} className="underline">
                    {s.id}
                  </Link>
                </td>
                <td className="py-2 text-neutral-500">{s.status}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatInr((JSON.parse(s.totals_json) as { total_paise: number }).total_paise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
