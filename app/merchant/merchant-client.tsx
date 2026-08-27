'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { MerchantStats } from '@/lib/merchant'

const inr = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(paise / 100)

const inrExact = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
    .format(paise / 100)

/** Counts from the previous value to the new one so a sale is visible, not just present. */
function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const frameRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return

    const start = performance.now()

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) frameRef.current = requestAnimationFrame(step)
      else fromRef.current = target
    }

    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, durationMs])

  return value
}

export function MerchantClient({ initial }: { initial: MerchantStats }) {
  const [stats, setStats] = useState(initial)
  const [flash, setFlash] = useState(false)
  const previousOrders = useRef(initial.orders)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/merchant/stats', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const next = (await res.json()) as MerchantStats

        if (next.orders > previousOrders.current) {
          setFlash(true)
          setTimeout(() => setFlash(false), 1200)
        }
        previousOrders.current = next.orders
        setStats(next)
      } catch {
        // A missed poll is not worth surfacing; the next one will land.
      }
    }

    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const revenue = useCountUp(stats.revenue_paise)
  const agentShare = stats.agent_share_bps / 100
  const humanShare = 100 - agentShare

  return (
    <div className="space-y-10">
      <section
        className={`rounded-lg border p-6 transition-colors duration-500 ${
          flash
            ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40'
            : 'border-neutral-200 dark:border-neutral-800'
        }`}
      >
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Captured revenue</span>
          <span className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            live
          </span>
        </div>

        <div className="mt-2 text-5xl font-medium tabular-nums tracking-tight">{inr(revenue)}</div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
          <div>
            <div className="text-xl tabular-nums">{stats.orders}</div>
            <div className="text-xs text-neutral-500 mt-0.5">orders</div>
          </div>
          <div>
            <div className="text-xl tabular-nums">{inr(stats.average_order_paise)}</div>
            <div className="text-xs text-neutral-500 mt-0.5">average order</div>
          </div>
          <div>
            <div className="text-xl tabular-nums">{stats.agent.orders}</div>
            <div className="text-xs text-neutral-500 mt-0.5">bought by agents</div>
          </div>
          <div>
            <div className="text-xl tabular-nums">{stats.refusals}</div>
            <div className="text-xs text-neutral-500 mt-0.5">requests refused</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Where the money came from
        </h2>

        {stats.orders === 0 ? (
          <p className="mt-4 text-neutral-500">
            No revenue yet.{' '}
            <Link href="/shop" className="underline">
              Buy something
            </Link>{' '}
            or let an agent do it.
          </p>
        ) : (
          <>
            <div className="mt-4 flex h-3 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-900">
              <div
                className="bg-neutral-400 dark:bg-neutral-600"
                style={{ width: `${humanShare}%` }}
                aria-label={`Humans ${humanShare.toFixed(1)} percent`}
              />
              <div
                className="bg-amber-500"
                style={{ width: `${agentShare}%` }}
                aria-label={`Agents ${agentShare.toFixed(1)} percent`}
              />
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                  Humans in the browser
                </div>
                <div className="mt-2 text-2xl tabular-nums">{inr(stats.human.revenue_paise)}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {stats.human.orders} order{stats.human.orders === 1 ? '' : 's'} ·{' '}
                  {humanShare.toFixed(1)}%
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  AI agents
                </div>
                <div className="mt-2 text-2xl tabular-nums">{inr(stats.agent.revenue_paise)}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {stats.agent.orders} order{stats.agent.orders === 1 ? '' : 's'} ·{' '}
                  {agentShare.toFixed(1)}%
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-10">
        <section>
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
            Best sellers
          </h2>
          {stats.top_products.length === 0 ? (
            <p className="mt-4 text-neutral-500 text-sm">Nothing sold yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
              {stats.top_products.map((p) => (
                <li key={p.product_id} className="py-3 flex items-center gap-3 text-sm">
                  <span className="flex-1">{p.title}</span>
                  <span className="text-neutral-500 tabular-nums">{p.units}</span>
                  <span className="tabular-nums w-24 text-right">{inr(p.revenue_paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
            What the gate refused
          </h2>
          {stats.refusals_by_reason.length === 0 ? (
            <p className="mt-4 text-neutral-500 text-sm">Nothing refused yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
              {stats.refusals_by_reason.map((r) => (
                <li key={r.reason} className="py-3 flex items-center gap-3 text-sm">
                  <span className="flex-1 font-mono text-xs">{r.reason}</span>
                  <span className="tabular-nums text-neutral-500">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            Each of these is a payment that did not happen because something did not add up.
          </p>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Recent payments
        </h2>
        {stats.recent.length === 0 ? (
          <p className="mt-4 text-neutral-500 text-sm">No payments captured yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
            {stats.recent.map((order) => (
              <li key={order.session_id}>
                <Link
                  href={`/sessions/${order.session_id}`}
                  className="py-3 flex items-center gap-3 text-sm group"
                >
                  <span
                    className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                      order.channel === 'human'
                        ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-500'
                    }`}
                  >
                    {order.channel}
                  </span>
                  <span className="font-mono text-xs text-neutral-500 truncate group-hover:underline">
                    {order.reference ?? order.session_id}
                  </span>
                  <span className="ml-auto tabular-nums shrink-0">
                    {inrExact(order.amount_paise)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
