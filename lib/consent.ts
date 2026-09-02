import { append } from './audit.ts'
import { authorize } from './gate.ts'
import { ApiError } from './http.ts'
import type { Paise } from './money.ts'
import { executor } from './pay/index.ts'
import { forSession as paymentsForSession } from './pay/store.ts'
import { detectDrift, find as findQuote, isExpired, issue as issueQuote, type PriceDrift } from './quote.ts'
import { get as getSession, resolveItems, update as updateSession } from './session/store.ts'
import * as wallet from './wallet.ts'

export type ConsentResult =
  /** The price moved while the link sat in an inbox. Nothing is signed yet. */
  | { outcome: 'price_changed'; amountPaise: Paise; previousPaise: Paise; drift: PriceDrift[]; summary: string }
  /** Mandates signed, order placed, buyer still has to pay it. */
  | { outcome: 'authorized'; sessionId: string; orderId: string | null; amountPaise: Paise }
  /** Already settled — the link was opened again after payment. */
  | { outcome: 'captured'; sessionId: string; amountPaise: Paise }

/**
 * Grants a pending approval and immediately spends it.
 *
 * This is the emailed consent link. It collapses two steps a human would
 * otherwise do minutes apart — approving in a wallet, then paying — into one
 * press, without weakening what the merchant checks: the mandates are still
 * signed here, the same gate still evaluates the same twelve checks, and the
 * sale still completes only on the provider's signed capture webhook.
 *
 * Consent is always given against a live price. A quote that expired in the
 * inbox is relocked; if that changes what is owed, nothing is signed and the
 * new total comes back for the human to confirm explicitly.
 */
export async function approveAndPay(
  approvalId: string,
  confirmedAmountPaise?: number,
): Promise<ConsentResult> {
  const approval = wallet.get(approvalId)

  if (approval.revoked_at) {
    throw new ApiError(409, 'approval_revoked', 'this approval was withdrawn')
  }
  if (approval.status === 'denied') {
    throw new ApiError(409, 'approval_denied', 'this purchase was declined')
  }

  // Reopening the link after it was used should show the payment, not make a
  // second one. The gate would refuse anyway; this refuses more legibly.
  if (approval.status === 'approved') {
    return settled(approval.session_id)
  }

  const session = getSession(approval.session_id)

  if (session.status !== 'ready_for_payment') {
    throw new ApiError(409, 'session_not_payable', `this checkout is ${session.status}`)
  }

  const quote = findQuote(approval.quote_id)

  if (!quote || isExpired(quote)) {
    const changed = await relock(approval, session.id, confirmedAmountPaise)
    if (changed) return changed
  }

  const granted = wallet.approve(approval.id)

  append({
    sessionId: granted.session_id,
    actor: granted.subject,
    action: 'gate.consume',
    decision: 'allow',
    reason: 'approved_on_consent_page',
    detail: { approval: granted.id, amount_paise: granted.amount_paise, agent: granted.agent_id },
  })

  const result = await authorize(
    {
      sessionId: granted.session_id,
      callerAgentId: granted.agent_id,
      intentJws: granted.intent_jws!,
      cartJws: granted.cart_jws!,
      // Checkout opens on the same press, so no "waiting to be paid" mail.
      buyerPresent: true,
    },
    executor(),
    `consent:${granted.id}`,
  )

  if (!result.decision.allow) {
    throw new ApiError(409, result.decision.code, result.decision.message)
  }

  const body = result.body as { payment?: { provider_order_id?: string | null; amount_paise?: number } }

  if (result.status === 200) {
    return { outcome: 'captured', sessionId: granted.session_id, amountPaise: granted.amount_paise as Paise }
  }

  return {
    outcome: 'authorized',
    sessionId: granted.session_id,
    orderId: body.payment?.provider_order_id ?? null,
    amountPaise: granted.amount_paise as Paise,
  }
}

/** What an already-decided approval should show when its link is reopened. */
function settled(sessionId: string): ConsentResult {
  const session = getSession(sessionId)
  const payments = paymentsForSession(sessionId)
  const captured = payments.find((p) => p.status === 'captured')
  const live = payments.find((p) => p.status === 'authorized')

  if (captured) {
    return { outcome: 'captured', sessionId, amountPaise: captured.amount_paise as Paise }
  }
  if (live) {
    return {
      outcome: 'authorized',
      sessionId,
      orderId: live.razorpay_order_id,
      amountPaise: live.amount_paise as Paise,
    }
  }

  throw new ApiError(409, 'nothing_to_pay', `this checkout is ${session.status} and has no live payment`)
}

/**
 * Relocks an expired price before consent is signed.
 *
 * Returns a `price_changed` result when the human has to look again, and null
 * when the total is unchanged — or when they have already confirmed the new
 * one, which is what `confirmedAmountPaise` carries.
 */
async function relock(
  approval: wallet.ApprovalRow,
  sessionId: string,
  confirmedAmountPaise?: number,
): Promise<ConsentResult | null> {
  let session = getSession(sessionId)
  const drift = detectDrift(session.items)

  // A withdrawn or unstocked line cannot be repriced into existence.
  const blocking = drift.filter((d) => d.reason !== 'price_changed')
  if (blocking.length > 0) {
    throw new ApiError(
      409,
      'catalog_changed',
      `no longer available: ${blocking.map((d) => d.product_id).join(', ')}`,
    )
  }

  if (drift.length > 0) {
    // Prices are re-resolved from the catalogue, never carried over.
    const repriced = resolveItems(session.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })))
    session = updateSession(session.id, session.version, { items: repriced })
  }

  const issued = issueQuote(session)
  session = updateSession(session.id, session.version, { quoteId: issued.id })

  const summary = wallet.summarize(session.items)
  const previous = approval.amount_paise as Paise
  const now = session.totals.total_paise

  wallet.rewriteQuote(approval.id, issued.id, now, summary)

  if (now === previous || confirmedAmountPaise === now) return null

  return { outcome: 'price_changed', amountPaise: now, previousPaise: previous, drift, summary }
}
