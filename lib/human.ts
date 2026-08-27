import { randomUUID, timingSafeEqual } from 'node:crypto'
import { cartHash } from './catalog.ts'
import { sha256 } from './canonical.ts'
import { db } from './db/client.ts'
import { authorize, type AuthorizeResult } from './gate.ts'
import { ApiError } from './http.ts'
import { issueCart, issueIntent } from './mandate/issue.ts'
import { executor } from './pay/index.ts'
import { detectDrift, issue as issueQuote, isExpired, byId as quoteById } from './quote.ts'
import type { Fulfillment } from './session/machine.ts'
import { create, get, resolveItems, update, type Session } from './session/store.ts'

/**
 * A shopper using the website rather than an agent.
 *
 * This identity is never registered in the agents table, so it has no secret
 * and no caller can authenticate as it. That is what stops a buyer agent from
 * routing around its own mandate requirements by pretending to be a person.
 */
export const WEB_BUYER = 'human:web'
export const WEB_SUBJECT = 'user_web'

const tokenHash = (token: string): string => sha256(`claim:${token}`)

function assertClaim(session: Session, token: string): void {
  if (session.agentId !== WEB_BUYER) {
    throw new ApiError(403, 'not_a_web_checkout', 'this checkout does not belong to the website')
  }

  const stored = db()
    .prepare('SELECT claim_token_hash FROM checkout_sessions WHERE id = ?')
    .get(session.id) as { claim_token_hash: string | null } | undefined

  const expected = stored?.claim_token_hash
  if (!expected) throw new ApiError(403, 'claim_missing', 'this checkout cannot be claimed')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(tokenHash(token), 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(403, 'claim_invalid', 'this checkout belongs to a different browser')
  }
}

export interface StartedCheckout {
  session: Session
  claimToken: string
}

export function startCheckout(items: unknown, fulfillment: Fulfillment | null): StartedCheckout {
  const session = create({ agentId: WEB_BUYER, items: resolveItems(items), fulfillment })
  const claimToken = randomUUID()

  db()
    .prepare('UPDATE checkout_sessions SET claim_token_hash = ? WHERE id = ?')
    .run(tokenHash(claimToken), session.id)

  return { session, claimToken }
}

export function setFulfillment(sessionId: string, claimToken: string, fulfillment: Fulfillment): Session {
  const session = get(sessionId)
  assertClaim(session, claimToken)
  return update(session.id, session.version, { fulfillment, quoteId: null })
}

export function quote(sessionId: string, claimToken: string) {
  const session = get(sessionId)
  assertClaim(session, claimToken)

  if (session.status !== 'ready_for_payment') {
    throw new ApiError(409, 'session_not_payable', `session is ${session.status}`)
  }
  if (detectDrift(session.items).length > 0) {
    throw new ApiError(409, 'catalog_changed', 'the catalogue moved before this quote could be issued')
  }

  const issued = issueQuote(session)
  update(session.id, session.version, { quoteId: issued.id })
  return issued
}

/**
 * Completes a browser purchase.
 *
 * The shopper is present, so consent is given by the click itself — but it is
 * still expressed as a signed mandate and still evaluated by the same gate the
 * agent path uses. There is exactly one way to spend money in this system, and
 * a human purchase produces the same twelve checks in the same audit trail.
 */
export async function pay(sessionId: string, claimToken: string): Promise<AuthorizeResult> {
  const session = get(sessionId)
  assertClaim(session, claimToken)

  if (session.status !== 'ready_for_payment') {
    throw new ApiError(409, 'session_not_payable', `session is ${session.status}`)
  }
  if (!session.quoteId) {
    throw new ApiError(409, 'quote_required', 'this checkout has no active quote')
  }

  const active = quoteById(session.quoteId)
  if (isExpired(active)) {
    throw new ApiError(409, 'quote_expired', 'the price you were shown has expired; refresh to see the current total')
  }

  const intent = issueIntent({
    subject: WEB_SUBJECT,
    agent: WEB_BUYER,
    scope: { max_amount_paise: session.totals.total_paise, max_uses: 1 },
    ttlSeconds: 300,
  })

  const cart = issueCart({
    subject: WEB_SUBJECT,
    agent: WEB_BUYER,
    intentJti: intent.payload.jti,
    sessionId: session.id,
    quoteId: active.id,
    cartHash: cartHash(session.items),
    amountPaise: session.totals.total_paise,
  })

  return authorize(
    { sessionId: session.id, callerAgentId: WEB_BUYER, intentJws: intent.jws, cartJws: cart.jws },
    executor(),
    `web:${session.id}:${active.id}`,
  )
}
