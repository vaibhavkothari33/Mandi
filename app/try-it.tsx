'use client'

import { useState } from 'react'

export interface OfferedAttack {
  id: number
  name: string
  premise: string
  expected: string
}

interface Result {
  refused: boolean
  code: string
  detail: string
}

export function TryIt({ attacks }: { attacks: OfferedAttack[] }) {
  const [results, setResults] = useState<Record<number, Result>>({})
  const [running, setRunning] = useState<number | null>(null)

  const attempt = async (id: number) => {
    setRunning(id)

    try {
      const res = await fetch('/api/try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attack: id }),
      })
      const json = await res.json()

      setResults((prev) => ({
        ...prev,
        [id]: res.ok
          ? { refused: json.refused, code: json.code, detail: json.detail }
          : { refused: false, code: json.error?.code ?? 'error', detail: json.error?.message ?? '' },
      }))
    } catch {
      setResults((prev) => ({
        ...prev,
        [id]: { refused: false, code: 'unreachable', detail: 'the merchant did not answer' },
      }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {attacks.map((attack) => {
        const result = results[attack.id]
        const busy = running === attack.id

        return (
          <div
            key={attack.id}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5 flex flex-col"
          >
            <div className="text-sm font-medium">{attack.name}</div>
            <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400 flex-1 text-pretty">
              {attack.premise}
            </p>

            {result ? (
              <div
                className={`mt-4 rounded-md border p-3 ${
                  result.refused
                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                    : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                }`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={
                      result.refused
                        ? 'text-emerald-700 dark:text-emerald-500'
                        : 'text-red-700 dark:text-red-500'
                    }
                  >
                    {result.refused ? 'Refused' : 'Got through'}
                  </span>
                  <code className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {result.code}
                  </code>
                </div>
                {result.detail && (
                  <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    {result.detail}
                  </p>
                )}
              </div>
            ) : null}

            <button
              onClick={() => attempt(attack.id)}
              disabled={busy || running !== null}
              className="mt-4 self-start px-4 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
            >
              {busy ? 'Attacking…' : result ? 'Run it again' : 'Try it'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
