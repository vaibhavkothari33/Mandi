import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProduct } from '@/lib/catalog'
import { MERCHANT } from '@/lib/config'
import { formatInr } from '@/lib/money'
import { forSession as paymentsForSession } from '@/lib/pay/store'
import { find as findQuote, isExpired, secondsRemaining } from '@/lib/quote'
import { get as getSession } from '@/lib/session/store'
import { find as findApproval } from '@/lib/wallet'
import { ApproveClient } from './approve-client'

export const dynamic = 'force-dynamic'

/**
 * The consent page an agent's buyer is emailed.
 *
 * It shows what is being asked for and by whom, and nothing more happens until
 * the button is pressed. Rendering never signs, relocks or charges anything —
 * every mutation lives behind the POST, so opening the link twice is inert.
 */
export default async function ApprovePage({ params }: PageProps<'/approve/[id]'>) {
  const { id } = await params

  const approval = findApproval(id)
  if (!approval) notFound()

  const session = getSession(approval.session_id)
  const payments = paymentsForSession(session.id)
  const captured = payments.find((p) => p.status === 'captured')
  const quote = findQuote(approval.quote_id)
  const stale = !quote || isExpired(quote)

  const shell = (children: React.ReactNode) => (
    <main className="max-w-md mx-auto px-6 py-16">
      <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{MERCHANT.name}</p>
      {children}
      <p className="mt-10 font-mono text-[11px] text-neutral-400 break-all">{approval.id}</p>
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

  if (approval.revoked_at || approval.status === 'denied') {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">
          {approval.status === 'denied' ? 'Declined' : 'Withdrawn'}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This request is closed. {approval.agent_id} cannot spend against it. Ask for a fresh one if you meant to buy.
        </p>
      </>,
    )
  }

  const summary = session.items
    .map((item) => `${item.quantity} × ${getProduct(item.product_id)?.title ?? item.product_id}`)
    .join(', ')

  return shell(
    <>
      <h1 className="mt-3 text-2xl font-medium tracking-tight">Approve this purchase</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="font-mono text-xs">{approval.agent_id}</span> asked to spend on your behalf. It cannot
        approve this itself, and it cannot spend more than the total below.
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

      <p className="mt-3 text-xs text-neutral-500">
        {stale
          ? 'The price lock expired while this was waiting. Pressing below relocks it at the current catalogue price and shows you the total again if it moved.'
          : `Price locked for another ${secondsRemaining(quote)}s. It is relocked automatically if that runs out.`}
      </p>

      <ApproveClient
        approvalId={approval.id}
        amountPaise={session.totals.total_paise}
        merchantName={MERCHANT.name}
        description={summary.slice(0, 255)}
        sessionId={session.id}
      />
    </>,
  )
}
