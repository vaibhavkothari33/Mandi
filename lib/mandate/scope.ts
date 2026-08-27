import type { Paise } from '../money.ts'
import { formatInr } from '../money.ts'
import type { Verdict } from './verify.ts'
import type { CartPayload, IntentPayload } from './types.ts'

const refuse = (code: string, message: string): Verdict<true> => ({ ok: false, code, message })

/**
 * A cart mandate may only draw within the intent that authorised it. The
 * intent behaves like a UPI Reserve Pay limit: one consent, drawn down by
 * successive purchases until it is exhausted or expires.
 */
export function checkCartWithinIntent(opts: {
  cart: CartPayload
  intent: IntentPayload
  categories: string[]
  alreadySpentPaise: Paise
  alreadyUsed: number
}): Verdict<true> {
  const { cart, intent, categories, alreadySpentPaise, alreadyUsed } = opts

  if (cart.intent_jti !== intent.jti) {
    return refuse('mandate_chain_mismatch', 'cart mandate does not reference this intent')
  }
  if (cart.agent !== intent.agent) {
    return refuse('mandate_agent_mismatch', `cart authorises ${cart.agent}, intent authorises ${intent.agent}`)
  }
  if (cart.sub !== intent.sub) {
    return refuse('mandate_subject_mismatch', 'cart and intent were granted by different subjects')
  }
  if (cart.currency !== intent.scope.currency) {
    return refuse('scope_currency', `intent authorises ${intent.scope.currency}, cart is ${cart.currency}`)
  }

  if (intent.scope.max_uses !== null && alreadyUsed >= intent.scope.max_uses) {
    return refuse('scope_uses_exhausted', `intent permits ${intent.scope.max_uses} use(s), already used ${alreadyUsed}`)
  }

  const remaining = intent.scope.max_amount_paise - alreadySpentPaise
  if (cart.amount_paise > remaining) {
    return refuse(
      'scope_amount_exceeded',
      `cart of ${formatInr(cart.amount_paise)} exceeds remaining authority of ${formatInr(Math.max(0, remaining))}`,
    )
  }

  if (intent.scope.categories) {
    const allowed = new Set(intent.scope.categories)
    const blocked = [...new Set(categories)].filter((c) => !allowed.has(c))
    if (blocked.length > 0) {
      return refuse('scope_category', `intent does not authorise category: ${blocked.join(', ')}`)
    }
  }

  return { ok: true, payload: true }
}
