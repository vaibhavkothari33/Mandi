import { cartHash } from './catalog.ts'
import { db, nowIso } from './db/client.ts'
import { ApiError } from './http.ts'
import { formatInr } from './money.ts'
import { issueCart, issueIntent } from './mandate/issue.ts'
import { byId as quoteById, isExpired, secondsRemaining } from './quote.ts'
import { get as getSession } from './session/store.ts'

export interface ApprovalRow {
  id: string
  session_id: string
  quote_id: string
  agent_id: string
  subject: string
  amount_paise: number
  summary: string
  status: 'pending' | 'approved' | 'denied'
  intent_jws: string | null
  cart_jws: string | null
  created_at: string
  decided_at: string | null
}

/**
 * The buyer's side of the transaction. This is deliberately not part of the
 * merchant API: an agent can ask for consent, but only a human can grant it,
 * and mandates are signed here rather than anywhere the agent can reach.
 */
const approvalId = (): string => `apr_${Math.random().toString(36).slice(2, 10)}`

export function request(sessionId: string, agentId: string): ApprovalRow {
  const session = getSession(sessionId)

  if (session.status !== 'ready_for_payment') {
    throw new ApiError(409, 'session_not_payable', `session is ${session.status}`)
  }
  if (!session.quoteId) {
    throw new ApiError(409, 'quote_required', 'request a quote before asking for approval')
  }

  const quote = quoteById(session.quoteId)
  if (isExpired(quote)) throw new ApiError(409, 'quote_expired', 'the quote expired; request a fresh one')

  const summary = session.items
    .map((i) => `${i.quantity} x ${i.product_id} @ ${formatInr(i.unit_price_paise)}`)
    .join(', ')

  return db()
    .prepare(
      `INSERT INTO approvals
         (id, session_id, quote_id, agent_id, subject, amount_paise, summary, status, created_at)
       VALUES (?, ?, ?, ?, 'user_demo', ?, ?, 'pending', ?) RETURNING *`,
    )
    .get(
      approvalId(),
      session.id,
      quote.id,
      agentId,
      session.totals.total_paise,
      summary,
      nowIso(),
    ) as unknown as ApprovalRow
}

export const find = (id: string): ApprovalRow | undefined =>
  db().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined

export function get(id: string): ApprovalRow {
  const row = find(id)
  if (!row) throw new ApiError(404, 'approval_not_found', `no such approval: ${id}`)
  return row
}

export const pending = (): ApprovalRow[] =>
  db()
    .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at")
    .all() as unknown as ApprovalRow[]

/**
 * Signs the mandates. Called only from the approval CLI, which stands in for a
 * wallet app where a human would confirm on their own device.
 */
export function approve(
  id: string,
  opts: { maxAmountPaise?: number; categories?: string[] | null; maxUses?: number | null } = {},
): ApprovalRow {
  const approval = get(id)
  if (approval.status !== 'pending') {
    throw new ApiError(409, 'approval_decided', `approval is already ${approval.status}`)
  }

  const session = getSession(approval.session_id)
  const quote = quoteById(approval.quote_id)

  if (isExpired(quote)) throw new ApiError(409, 'quote_expired', 'the quote expired before approval')
  if (session.totals.total_paise !== approval.amount_paise) {
    throw new ApiError(409, 'amount_changed', 'the total changed since approval was requested')
  }

  const intent = issueIntent({
    subject: approval.subject,
    agent: approval.agent_id,
    scope: {
      max_amount_paise: opts.maxAmountPaise ?? approval.amount_paise,
      categories: opts.categories ?? null,
      max_uses: opts.maxUses ?? 1,
    },
  })

  const cart = issueCart({
    subject: approval.subject,
    agent: approval.agent_id,
    intentJti: intent.payload.jti,
    sessionId: session.id,
    quoteId: quote.id,
    cartHash: cartHash(session.items),
    amountPaise: session.totals.total_paise,
    ttlSeconds: Math.max(30, secondsRemaining(quote)),
  })

  return db()
    .prepare(
      `UPDATE approvals SET status = 'approved', intent_jws = ?, cart_jws = ?, decided_at = ?
        WHERE id = ? RETURNING *`,
    )
    .get(intent.jws, cart.jws, nowIso(), id) as unknown as ApprovalRow
}

export function deny(id: string): ApprovalRow {
  const approval = get(id)
  if (approval.status !== 'pending') {
    throw new ApiError(409, 'approval_decided', `approval is already ${approval.status}`)
  }

  return db()
    .prepare("UPDATE approvals SET status = 'denied', decided_at = ? WHERE id = ? RETURNING *")
    .get(nowIso(), id) as unknown as ApprovalRow
}
