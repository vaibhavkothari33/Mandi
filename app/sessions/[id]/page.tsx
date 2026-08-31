import Link from 'next/link'
import { notFound } from 'next/navigation'
import { forSession, type AuditRow } from '@/lib/audit'
import { getProduct } from '@/lib/catalog'
import { WEB_BUYER } from '@/lib/human'
import { formatInr } from '@/lib/money'
import { forSession as paymentsForSession } from '@/lib/pay/store'
import { get as getSession } from '@/lib/session/store'
import { ProductArt } from '@/app/shop/product-art'

export const dynamic = 'force-dynamic'

interface Check {
  name: string
  passed: boolean
  detail?: string
}

/** Plain-language names for the things the audit log records. */
const ACTIONS: Record<string, string> = {
  'session.create': 'Checkout opened',
  'session.update': 'Cart or address changed',
  'session.quote': 'Price locked',
  // The wrapper around the whole request, so it lands after the gate and the
  // payment it enclosed. Named for that rather than for what was attempted.
  'session.complete': 'Request finished',
  'session.cancel': 'Checkout cancelled',
  'gate.evaluate': 'Authorisation checked',
  'gate.consume': 'Approval spent',
  'payment.capture': 'Payment',
  'webhook.settle': 'Provider confirmed',
  'webhook.receive': 'Provider notified us',
}

const CHECKS: Record<string, string> = {
  session_exists: 'This checkout exists',
  session_payable: 'It is still open for payment',
  no_live_payment: 'Nothing has been charged for it yet',
  intent_mandate_valid: 'The spending limit that was signed is valid',
  cart_mandate_valid: 'The approval of this exact cart is valid',
  agent_matches_caller: 'The buyer paying is the buyer who was approved',
  cart_bound_to_session: 'The approval was issued for this checkout',
  quote_current: 'The locked price has not expired',
  cart_unchanged: 'The cart has not changed since approval',
  price_unchanged: 'Catalogue prices have not moved since approval',
  amount_matches_total: 'The approved amount matches the bill',
  within_intent_scope: 'The amount is inside the limit that was granted',
}

export default async function SessionPage({ params }: PageProps<'/sessions/[id]'>) {
  const { id } = await params

  let session
  try {
    session = getSession(id)
  } catch {
    notFound()
  }

  const trail = forSession(id)
  const payments = paymentsForSession(id)
  const isHuman = session.agentId === WEB_BUYER

  const captured = payments.find((p) => p.status === 'captured')
  const gate = [...trail].reverse().find((e) => e.action === 'gate.evaluate')
  const gateChecks = gate ? ((JSON.parse(gate.detail_json).checks ?? []) as Check[]) : []

  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-medium' : ''}`}>{value}</span>
    </div>
  )

  return (
    <main className="max-w-3xl mx-auto px-6 py-14">
      <Link href="/orders" className="text-sm text-neutral-500 hover:underline">
        back to orders
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-medium tracking-tight">Order</h1>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            isHuman
              ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-500'
          }`}
        >
          {isHuman ? 'bought in the browser' : `bought by ${session.agentId ?? 'no buyer'}`}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {session.status.replace(/_/g, ' ')}
        </span>
      </div>

      <p className="mt-2 font-mono text-xs text-neutral-500 break-all">{session.id}</p>

      <section className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 text-sm font-medium">
          What was ordered
        </div>

        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {session.items.map((item) => {
            const product = getProduct(item.product_id)
            return (
              <li key={item.product_id} className="px-5 py-3 flex items-center gap-4">
                <ProductArt
                  productId={item.product_id}
                  category={product?.category ?? 'grocery'}
                  className="w-12 h-12 rounded-md shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{product?.title ?? item.product_id}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {formatInr(item.unit_price_paise)} each
                    {product ? ` · ${product.category}` : ''}
                  </div>
                </div>
                <span className="text-sm text-neutral-500 tabular-nums shrink-0">
                  × {item.quantity}
                </span>
                <span className="text-sm tabular-nums w-24 text-right shrink-0">
                  {formatInr(item.unit_price_paise * item.quantity)}
                </span>
              </li>
            )
          })}
        </ul>

        <div className="px-5 py-4 border-t border-neutral-200 dark:border-neutral-800 space-y-1.5 bg-neutral-50 dark:bg-neutral-900/40">
          {row('Items', formatInr(session.totals.items_paise))}
          {row('Shipping', session.totals.shipping_paise === 0 ? 'free' : formatInr(session.totals.shipping_paise))}
          {row('GST', formatInr(session.totals.tax_paise))}
          <div className="pt-1.5 border-t border-neutral-200 dark:border-neutral-800">
            {row('Total', formatInr(session.totals.total_paise), true)}
          </div>
        </div>
      </section>

      <div className="mt-6 grid sm:grid-cols-2 gap-6">
        {session.fulfillment && (
          <section>
            <h2 className="text-sm font-medium">Delivering to</h2>
            <address className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 not-italic leading-relaxed">
              {session.fulfillment.name}
              <br />
              {session.fulfillment.line1}
              {session.fulfillment.line2 ? <><br />{session.fulfillment.line2}</> : null}
              <br />
              {session.fulfillment.city}, {session.fulfillment.state} {session.fulfillment.postal_code}
              <br />
              {session.fulfillment.country}
            </address>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium">Payment</h2>
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing charged.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-neutral-500">{p.status}</span>
                    <span className="tabular-nums">{formatInr(p.amount_paise)}</span>
                  </div>
                  {p.razorpay_payment_id && (
                    <div className="font-mono text-xs text-neutral-500 mt-0.5 break-all">
                      {p.razorpay_payment_id}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {captured && (
            <p className="mt-2 text-xs text-neutral-500">
              Razorpay test mode. No real money moved.
            </p>
          )}
        </section>
      </div>

      {gateChecks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium">
            What was verified before charging
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Every one of these ran on this order, in this order, whoever placed it.
          </p>

          <ol className="mt-4 space-y-1.5">
            {gateChecks.map((check, index) => (
              <li key={check.name} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 shrink-0 w-5 text-center ${
                    check.passed
                      ? 'text-emerald-700 dark:text-emerald-500'
                      : 'text-red-700 dark:text-red-500'
                  }`}
                  aria-hidden
                >
                  {check.passed ? '✓' : '✕'}
                </span>
                <span className="text-neutral-400 tabular-nums shrink-0 w-5">{index + 1}</span>
                <span className="flex-1">
                  {CHECKS[check.name] ?? check.name}
                  {check.detail && (
                    <span className="block text-xs text-neutral-500 mt-0.5">{check.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-medium">Everything that happened</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Each entry is sealed with the one before it, so this record cannot be edited after the
          fact without breaking the chain — and each is signed with the merchant&rsquo;s Ed25519
          key, so an entry cannot be rewritten and re-chained by anyone who lacks that key. The
          public half is published at{' '}
          <code className="font-mono text-xs">/.well-known/jwks.json</code>.
        </p>

        <ol className="mt-5 border-l border-neutral-200 dark:border-neutral-800 ml-2">
          {trail.map((entry: AuditRow) => {
            const refused = entry.decision === 'refuse'
            return (
              <li key={entry.seq} className="relative pl-6 pb-5 last:pb-0">
                <span
                  className={`absolute left-0 top-1.5 -translate-x-1/2 w-2 h-2 rounded-full ${
                    refused
                      ? 'bg-red-500'
                      : entry.decision === 'allow'
                        ? 'bg-emerald-500'
                        : 'bg-neutral-400'
                  }`}
                />

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm">{ACTIONS[entry.action] ?? entry.action}</span>
                  {refused && entry.reason && (
                    <span className="text-xs text-red-700 dark:text-red-500">
                      refused — {entry.reason.replace(/_/g, ' ')}
                    </span>
                  )}
                  <time className="ml-auto text-xs text-neutral-500 tabular-nums">
                    {new Date(entry.at).toLocaleTimeString('en-IN', { hour12: false })}
                  </time>
                </div>

                <div className="mt-1 font-mono text-[11px] text-neutral-400 break-all">
                  {entry.hash.slice(0, 16)}
                  <span className="text-neutral-300 dark:text-neutral-600">
                    {' '}
                    ← {entry.prev_hash ? entry.prev_hash.slice(0, 12) : 'first entry'}
                  </span>
                </div>

                <div className="mt-0.5 font-mono text-[11px] break-all">
                  {entry.signature ? (
                    <span className="text-emerald-700 dark:text-emerald-500">
                      signed {entry.signature.slice(0, 16)}
                      <span className="text-neutral-400 dark:text-neutral-600">
                        {' '}
                        · {entry.kid}
                      </span>
                    </span>
                  ) : (
                    <span className="text-neutral-400">unsigned — predates entry signing</span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </main>
  )
}
