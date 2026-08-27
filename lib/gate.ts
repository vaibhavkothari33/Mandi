import { append } from './audit.ts'
import { cartHash, getProduct } from './catalog.ts'
import { db } from './db/client.ts'
import { formatInr } from './money.ts'
import { checkCartWithinIntent } from './mandate/scope.ts'
import { detectDrift, find as findQuote, isExpired, secondsRemaining } from './quote.ts'
import { consume, drawdown, usageCount } from './mandate/store.ts'
import type { CartPayload, IntentPayload } from './mandate/types.ts'
import { verifyCart, verifyIntent } from './mandate/verify.ts'
import type { PaymentExecutor } from './pay/executor.ts'
import { forSession as paymentsForSession, reserve, settle } from './pay/store.ts'
import { get as getSession, update as updateSession, type Session } from './session/store.ts'

export interface Check {
  name: string
  passed: boolean
  code?: string
  detail?: string
}

export interface GateDecision {
  allow: boolean
  code: string
  message: string
  checks: Check[]
  session?: Session
  intent?: IntentPayload
  cart?: CartPayload
}

export interface GateRequest {
  sessionId: string
  /** The agent identity proven by request signing, not one claimed in the body. */
  callerAgentId: string
  intentJws: string
  cartJws: string
}

/**
 * Deterministic authorisation. Every branch is explicit code with a distinct
 * refusal code, and the full sequence of checks is returned whether it passes
 * or fails, so the audit trail records what was evaluated rather than only the
 * verdict. No model output participates in any decision here.
 */
export function evaluate(request: GateRequest): GateDecision {
  const checks: Check[] = []

  const fail = (name: string, code: string, message: string): GateDecision => {
    checks.push({ name, passed: false, code, detail: message })
    return { allow: false, code, message, checks }
  }
  const pass = (name: string, detail?: string) => checks.push({ name, passed: true, detail })

  let session: Session
  try {
    session = getSession(request.sessionId)
  } catch {
    return fail('session_exists', 'session_not_found', `no such checkout session: ${request.sessionId}`)
  }
  pass('session_exists')

  if (session.status !== 'ready_for_payment') {
    return fail('session_payable', 'session_not_payable', `session is ${session.status}`)
  }
  pass('session_payable')

  if (paymentsForSession(session.id).some((p) => p.status !== 'failed')) {
    return fail('no_live_payment', 'payment_already_exists', 'this session already has a live payment')
  }
  pass('no_live_payment')

  const intentVerdict = verifyIntent(request.intentJws)
  if (!intentVerdict.ok) return fail('intent_mandate_valid', intentVerdict.code, intentVerdict.message)
  const intent = intentVerdict.payload
  pass('intent_mandate_valid', intent.jti)

  const cartVerdict = verifyCart(request.cartJws)
  if (!cartVerdict.ok) return fail('cart_mandate_valid', cartVerdict.code, cartVerdict.message)
  const cart = cartVerdict.payload
  pass('cart_mandate_valid', cart.jti)

  if (cart.agent !== request.callerAgentId) {
    return fail(
      'agent_matches_caller',
      'mandate_agent_mismatch',
      `mandate authorises ${cart.agent}, request is signed by ${request.callerAgentId}`,
    )
  }

  // A checkout belongs to whoever opened it. This is what keeps the browser
  // and the agent from reaching into each other's carts.
  if (session.agentId && cart.agent !== session.agentId) {
    return fail(
      'agent_matches_caller',
      'mandate_wrong_buyer',
      `this checkout belongs to ${session.agentId}, not ${cart.agent}`,
    )
  }
  pass('agent_matches_caller')

  if (cart.session_id !== session.id) {
    return fail('cart_bound_to_session', 'mandate_wrong_session', `cart mandate is bound to ${cart.session_id}`)
  }
  pass('cart_bound_to_session')

  if (cart.quote_id !== session.quoteId) {
    return fail(
      'quote_current',
      'quote_superseded',
      'the quote this mandate approved is no longer the active quote for this session',
    )
  }

  const quote = findQuote(cart.quote_id)
  if (!quote) return fail('quote_current', 'quote_not_found', `no such quote: ${cart.quote_id}`)
  if (isExpired(quote)) {
    return fail(
      'quote_current',
      'quote_expired',
      'the approved quote has expired; request a fresh quote and re-approve',
    )
  }
  pass('quote_current', `${secondsRemaining(quote)}s remaining`)

  const currentHash = cartHash(session.items, cart.currency)
  if (currentHash !== cart.cart_hash) {
    return fail(
      'cart_unchanged',
      'cart_hash_mismatch',
      'the cart has changed since it was approved; a fresh cart mandate is required',
    )
  }
  pass('cart_unchanged', currentHash.slice(0, 16))

  const drift = detectDrift(session.items)
  if (drift.length > 0) {
    const first = drift[0]
    return fail(
      'price_unchanged',
      'quote_price_drift',
      `${first.product_id} ${first.reason.replace('_', ' ')} since approval; a fresh quote and cart mandate are required`,
    )
  }
  pass('price_unchanged')

  if (cart.amount_paise !== session.totals.total_paise) {
    return fail(
      'amount_matches_total',
      'amount_mismatch',
      `mandate approves ${formatInr(cart.amount_paise)}, session totals ${formatInr(session.totals.total_paise)}`,
    )
  }
  pass('amount_matches_total', formatInr(cart.amount_paise))

  const spent = drawdown(intent.jti)
  const categories = [...new Set(session.items.map((i) => getProduct(i.product_id)?.category ?? 'unknown'))]

  const scopeVerdict = checkCartWithinIntent({
    cart,
    intent,
    categories,
    alreadySpentPaise: spent,
    alreadyUsed: usageCount(intent.jti),
  })
  if (!scopeVerdict.ok) return fail('within_intent_scope', scopeVerdict.code, scopeVerdict.message)
  pass('within_intent_scope', `remaining ${formatInr(intent.scope.max_amount_paise - spent - cart.amount_paise)}`)

  return { allow: true, code: 'authorized', message: 'authorized', checks, session, intent, cart }
}

export interface AuthorizeResult {
  decision: GateDecision
  status: number
  body: unknown
}

/** Only a definitively failed payment releases the mandate. */
function releaseMandate(jti: string): void {
  db().prepare('UPDATE mandates SET consumed_at = NULL WHERE id = ?').run(jti)
}

/**
 * Consumption happens before the provider is called, not after. If the process
 * dies mid-flight, a burnt mandate costs the buyer a re-consent; the reverse
 * ordering risks charging them twice.
 */
export async function authorize(
  request: GateRequest,
  executor: PaymentExecutor,
  idempotencyKey: string,
): Promise<AuthorizeResult> {
  const decision = evaluate(request)

  append({
    sessionId: request.sessionId,
    actor: request.callerAgentId,
    action: 'gate.evaluate',
    decision: decision.allow ? 'allow' : 'refuse',
    reason: decision.code,
    detail: { checks: decision.checks, message: decision.message },
  })

  if (!decision.allow) {
    return {
      decision,
      status: decision.code === 'session_not_found' ? 404 : 409,
      body: {
        error: { type: 'gate_refused', code: decision.code, message: decision.message },
        checks: decision.checks,
      },
    }
  }

  const session = decision.session as Session
  const cart = decision.cart as CartPayload
  const intent = decision.intent as IntentPayload

  if (!consume(cart.jti)) {
    append({
      sessionId: session.id,
      actor: request.callerAgentId,
      action: 'gate.consume',
      decision: 'refuse',
      reason: 'mandate_already_used',
      detail: { mandate: cart.jti },
    })

    return {
      decision,
      status: 409,
      body: {
        error: {
          type: 'gate_refused',
          code: 'mandate_already_used',
          message: 'cart mandate was consumed concurrently',
        },
      },
    }
  }

  const payment = reserve(session.id, cart.amount_paise, cart.currency)

  const result = await executor.execute({
    sessionId: session.id,
    amountPaise: cart.amount_paise,
    currency: cart.currency,
    idempotencyKey,
    description: `Mandi order ${session.id}`,
  })

  if (result.outcome === 'succeeded') {
    settle(payment.id, 'captured', { reference: result.reference, providerOrderId: result.providerOrderId })
    const completed = updateSession(session.id, session.version, { status: 'completed' })

    append({
      sessionId: session.id,
      actor: request.callerAgentId,
      action: 'payment.capture',
      decision: 'allow',
      detail: {
        payment: payment.id,
        reference: result.reference,
        amount_paise: cart.amount_paise,
        executor: executor.name,
      },
    })

    return {
      decision,
      status: 200,
      body: {
        id: completed.id,
        status: completed.status,
        payment: {
          id: payment.id,
          reference: result.reference,
          amount_paise: cart.amount_paise,
          currency: cart.currency,
        },
        mandate: { intent: intent.jti, cart: cart.jti },
        checks: decision.checks,
      },
    }
  }

  if (result.outcome === 'failed') {
    settle(payment.id, 'failed', { providerOrderId: result.providerOrderId })
    releaseMandate(cart.jti)

    append({
      sessionId: session.id,
      actor: request.callerAgentId,
      action: 'payment.capture',
      decision: 'refuse',
      reason: 'payment_failed',
      detail: { payment: payment.id, message: result.message, mandate_released: true },
    })

    return {
      decision,
      status: 402,
      body: { error: { type: 'payment_failed', code: 'payment_failed', message: result.message } },
    }
  }

  // Reconciliation needs the provider's handle precisely when the outcome is
  // unknown, so persist whatever identifiers came back before holding.
  settle(payment.id, 'pending', { providerOrderId: result.providerOrderId })

  append({
    sessionId: session.id,
    actor: request.callerAgentId,
    action: 'payment.capture',
    decision: 'refuse',
    reason: 'payment_indeterminate',
    detail: {
      payment: payment.id,
      provider_order_id: result.providerOrderId,
      message: result.message,
      mandate_released: false,
      requires_reconciliation: true,
    },
  })

  return {
    decision,
    status: 409,
    body: {
      error: {
        type: 'payment_indeterminate',
        code: 'payment_indeterminate',
        message: 'payment outcome could not be established; the session is held for reconciliation',
      },
      payment: { id: payment.id, status: 'pending' },
    },
  }
}
