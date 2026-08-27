import Link from 'next/link'
import { Coins } from './coins'
import { verifyChain } from '@/lib/audit'
import { db } from '@/lib/db/client'
import { WEB_BUYER } from '@/lib/human'
import { stats } from '@/lib/merchant'
import { formatInr } from '@/lib/money'

export const dynamic = 'force-dynamic'

const PROTOCOLS = ['Razorpay', 'NPCI UAP', 'ACP', 'AP2', 'MCP']

const GATE_CHECKS = [
  'This checkout exists',
  'It is still open for payment',
  'Nothing has been charged for it yet',
  'The spending limit that was signed is valid',
  'The approval of this exact cart is valid',
  'The buyer paying is the buyer who was approved',
]

interface OrderRow {
  id: string
  agent_id: string | null
  totals_json: string
}

/** Staggered entrance, driven entirely by CSS so this page ships no JS. */
const rise = (index: number) => ({ animationDelay: `${index * 110}ms` })

export default async function Home() {
  const merchant = stats()
  const chain = verifyChain()

  const attacks = db()
    .prepare('SELECT COUNT(*) AS total, SUM(refused) AS held FROM attack_results')
    .get() as { total: number; held: number | null }

  const recent = db()
    .prepare(
      `SELECT id, agent_id, totals_json FROM checkout_sessions
        WHERE status = 'completed' ORDER BY created_at DESC LIMIT 5`,
    )
    .all() as unknown as OrderRow[]

  const agentShare = merchant.agent_share_bps / 100
  const held = attacks.held ?? 0

  return (
    <main>
      <div className="px-3 sm:px-4 pt-3 sm:pt-4">
        <section className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-[#f6f4f1] dark:bg-neutral-900">
          {/* Self-contained background: no external asset to rot before the panel opens it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-25"
            style={{
              backgroundImage:
                'radial-gradient(circle at 50% -10%, rgba(245,158,11,0.18), transparent 60%), radial-gradient(circle at 85% 20%, rgba(120,113,108,0.10), transparent 45%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
            style={{
              backgroundImage: 'radial-gradient(currentColor 0.5px, transparent 0.5px)',
              backgroundSize: '22px 22px',
              color: '#a8a29e',
              maskImage: 'linear-gradient(to bottom, black, transparent 70%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 70%)',
            }}
          />

          <Coins />

          <div className="relative z-10 px-6 pt-14 sm:pt-20 text-center flex flex-col items-center">
            <span
              className="rise inline-flex items-center gap-2 rounded-full bg-white dark:bg-neutral-950 px-4 py-1.5 text-[13px] shadow-sm border border-neutral-200/70 dark:border-neutral-800"
              style={rise(0)}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Razorpay Buildathon · Track 01
            </span>

            <h1
              className="rise mt-6 max-w-3xl font-medium tracking-tight text-balance"
              style={{ ...rise(1), fontSize: 'clamp(32px, 6.5vw, 60px)', lineHeight: 1.05, letterSpacing: '-0.02em' }}
            >
              A shop an AI can buy from,
              <br />
              without being able to overspend.
            </h1>

            <p
              className="rise mt-5 max-w-xl text-neutral-600 dark:text-neutral-400 text-pretty"
              style={{ ...rise(2), fontSize: 'clamp(14px, 2.5vw, 17px)', lineHeight: 1.6 }}
            >
              Browse it yourself, or let Claude do it for you. Either way the same twelve
              deterministic checks stand between a request and your money.
            </p>

            <div className="rise mt-7 flex flex-wrap justify-center gap-3" style={rise(3)}>
              <Link
                href="/shop"
                className="inline-flex items-center gap-3 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 pl-6 pr-2 py-2 text-sm font-medium hover:opacity-90"
              >
                Shop it yourself
                <span className="w-7 h-7 rounded-full bg-white/15 dark:bg-neutral-900/10 grid place-items-center">
                  →
                </span>
              </Link>
              <Link
                href="/merchant"
                className="inline-flex items-center rounded-full border border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-950/40 px-6 py-2.5 text-sm font-medium hover:bg-white dark:hover:bg-neutral-950"
              >
                Watch an agent buy
              </Link>
            </div>

            <div
              className="rise mt-10 flex flex-wrap justify-center items-center gap-x-7 gap-y-2 text-[12px] font-semibold tracking-wide text-neutral-500 dark:text-neutral-500"
              style={rise(4)}
            >
              {PROTOCOLS.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          </div>

          {/* The proof tray. Clipped by the hero so the cards bleed off the bottom edge. */}
          <div className="relative z-10 mt-12 sm:mt-16 px-3 sm:px-6">
            <div className="mx-auto w-full max-w-4xl rounded-t-3xl bg-white/70 dark:bg-neutral-950/60 backdrop-blur-sm p-4 sm:p-6 pb-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <Link
                  href="/merchant"
                  className="rise rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 p-5 hover:border-neutral-300 dark:hover:border-neutral-700"
                  style={rise(5)}
                >
                  <div className="text-xs text-neutral-500">Captured revenue</div>
                  <div className="mt-1 text-2xl tabular-nums">
                    {formatInr(merchant.revenue_paise)}
                  </div>

                  <div className="mt-4 flex h-1.5 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                    <div className="bg-neutral-400 dark:bg-neutral-600" style={{ width: `${100 - agentShare}%` }} />
                    <div className="bg-amber-500" style={{ width: `${agentShare}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    <span className="text-amber-700 dark:text-amber-500 font-medium tabular-nums">
                      {agentShare.toFixed(1)}%
                    </span>{' '}
                    of it bought by agents
                  </div>
                </Link>

                <Link
                  href="/orders"
                  className="rise rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 p-5 hover:border-neutral-300 dark:hover:border-neutral-700"
                  style={rise(6)}
                >
                  <div className="text-xs text-neutral-500">Checked before charging</div>
                  <div className="mt-1 text-2xl tabular-nums">12 of 12</div>

                  <ul className="mt-3 space-y-1">
                    {GATE_CHECKS.map((label) => (
                      <li key={label} className="flex gap-2 text-[11px] text-neutral-500 leading-snug">
                        <span className="text-emerald-600 dark:text-emerald-500 shrink-0">✓</span>
                        <span className="truncate">{label}</span>
                      </li>
                    ))}
                  </ul>
                </Link>

                <Link
                  href="/attacks"
                  className="rise rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 p-5 hover:border-neutral-300 dark:hover:border-neutral-700"
                  style={rise(7)}
                >
                  <div className="text-xs text-neutral-500">Adversarial suite</div>
                  <div className="mt-1 text-2xl tabular-nums">
                    {attacks.total === 0 ? 'not run' : `${held} of ${attacks.total}`}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">attacks refused</div>

                  <div className="mt-4 grid grid-cols-4 gap-1.5">
                    {Array.from({ length: Math.max(attacks.total, 8) }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-6 rounded ${
                          i < held ? 'bg-emerald-500/80' : 'bg-neutral-200 dark:bg-neutral-800'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-3 text-[11px] text-neutral-500">
                    Runs in CI on every push
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide">
          Two buyers, one gate
        </h2>

        <div className="mt-8 grid md:grid-cols-2 gap-6">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
            <div className="text-sm font-medium">You, in the browser</div>
            <ol className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <li>1. Put things in a cart</li>
              <li>2. Enter an address</li>
              <li>3. See a price, locked for two minutes</li>
              <li>4. Click pay — you are present, so the click is the consent</li>
            </ol>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
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

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
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
          <span className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800">
            {merchant.orders} order{merchant.orders === 1 ? '' : 's'} ·{' '}
            {merchant.refusals} refusal{merchant.refusals === 1 ? '' : 's'} recorded
          </span>
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
