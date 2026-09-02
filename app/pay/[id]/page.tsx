import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProduct } from '@/lib/catalog'
import { MERCHANT } from '@/lib/config'
import { formatInr } from '@/lib/money'
import { forSession as paymentsForSession } from '@/lib/pay/store'
import { get as getSession } from '@/lib/session/store'
import { PayClient } from './pay-client'

export const dynamic = 'force-dynamic'

/**
 * The page a buyer is sent to when a session is authorised but unpaid.
 *
 * The gate has already created the Razorpay order by the time anyone lands
 * here, so this only hands that order to Checkout. It deliberately renders the
 * session's real status from the database rather than trusting anything in the
 * URL: a completed session shows as paid, a cancelled one offers nothing.
 */
export default async function PayPage({ params }: PageProps<'/pay/[id]'>) {
  const { id } = await params

  let session
  try {
    session = getSession(id)
  } catch {
    notFound()
  }

  const payments = paymentsForSession(id)
  const live = payments.find((p) => p.status === 'authorized')
  const captured = payments.find((p) => p.status === 'captured')
  const keyId = process.env.RAZORPAY_KEY_ID ?? null

  const shell = (children: React.ReactNode) => (
    <main className="max-w-md mx-auto px-6 py-16">
      <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{MERCHANT.name}</p>
      {children}
      <p className="mt-10 font-mono text-[11px] text-neutral-400 break-all">{session.id}</p>
      <Link href={`/sessions/${session.id}`} className="mt-2 inline-block text-xs text-neutral-500 hover:underline">
        view the full order trail
      </Link>
    </main>
  )

  if (captured || session.status === 'completed') {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">Paid</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {formatInr(session.totals.total_paise)} received and confirmed by Razorpay. Nothing further is due.
        </p>
      </>,
    )
  }

  if (!live) {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">Nothing to pay</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This checkout is {session.status.replace(/_/g, ' ')}. A payment link appears here only once a purchase has
          been approved and the order placed with the provider.
        </p>
      </>,
    )
  }

  if (!keyId || !live.razorpay_order_id) {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">Payment unavailable</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {keyId
            ? 'This payment was placed without a provider order, so there is nothing for Checkout to open.'
            : 'The merchant has no Razorpay key configured.'}
        </p>
      </>,
    )
  }

  const summary = session.items
    .map((item) => `${item.quantity} × ${getProduct(item.product_id)?.title ?? item.product_id}`)
    .join(', ')

  return shell(
    <>
      <h1 className="mt-3 text-2xl font-medium tracking-tight">Complete your payment</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Approved and awaiting payment. The amount below is the one that was approved — it cannot change here.
      </p>

      <section className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {session.items.map((item) => (
            <li key={item.product_id} className="px-4 py-3 flex justify-between gap-4 text-sm">
              <span>
                {getProduct(item.product_id)?.title ?? item.product_id}
                <span className="text-neutral-500"> × {item.quantity}</span>
              </span>
              <span className="tabular-nums shrink-0">{formatInr(item.unit_price_paise * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 flex justify-between text-sm font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatInr(session.totals.total_paise)}</span>
        </div>
      </section>

      <PayClient
        keyId={keyId}
        orderId={live.razorpay_order_id}
        sessionId={session.id}
        amountPaise={live.amount_paise}
        merchantName={MERCHANT.name}
        description={summary.slice(0, 255)}
      />
    </>,
  )
}
