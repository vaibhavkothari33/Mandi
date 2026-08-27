import Link from 'next/link'
import { db } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

interface AttackRow {
  id: number
  name: string
  premise: string
  expected: string
  actual: string
  refused: number
  detail: string
  ran_at: string
}

export default async function AttacksPage() {
  const rows = db()
    .prepare('SELECT * FROM attack_results ORDER BY id')
    .all() as unknown as AttackRow[]

  const held = rows.filter((r) => r.refused === 1).length

  return (
    <main className="max-w-4xl mx-auto p-8 font-mono text-sm">
      <Link href="/" className="text-neutral-500 underline">
        back
      </Link>

      <h1 className="text-lg mt-4">Adversarial suite</h1>
      <p className="text-neutral-500 mb-6">
        A hostile buyer agent attacking the gate. Every attempt is refused and logged.
      </p>

      {rows.length === 0 ? (
        <p className="text-neutral-500">Not run yet. Run `npm run attacks`.</p>
      ) : (
        <>
          <div className="border border-neutral-300 dark:border-neutral-700 p-4 mb-6 flex justify-between">
            <span>Result</span>
            <span className={held === rows.length ? 'text-green-700 dark:text-green-500' : 'text-red-700 dark:text-red-500'}>
              {held} of {rows.length} refused
            </span>
          </div>

          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.id} className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
                <div className="flex justify-between gap-4">
                  <span>
                    <span className="text-neutral-400">{row.id}.</span> {row.name}
                  </span>
                  <span className={row.refused ? 'text-green-700 dark:text-green-500' : 'text-red-700 dark:text-red-500'}>
                    {row.refused ? 'refused' : 'BREACH'}
                  </span>
                </div>

                <p className="text-neutral-500 mt-1">{row.premise}</p>

                <div className="mt-2 text-xs text-neutral-500">
                  expected <span className="text-neutral-700 dark:text-neutral-300">{row.expected}</span>
                  {' · '}
                  got <span className="text-neutral-700 dark:text-neutral-300">{row.actual}</span>
                </div>

                {row.detail && <p className="mt-1 text-xs text-neutral-400">{row.detail}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
