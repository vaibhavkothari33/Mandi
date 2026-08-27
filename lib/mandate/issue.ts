import { MERCHANT } from '../config.ts'
import { mandateId } from '../ids.ts'
import type { Paise } from '../money.ts'
import { encode } from './jws.ts'
import { ensureKeypair } from './keys.ts'
import { save } from './store.ts'
import type { CartPayload, IntentPayload, IntentScope } from './types.ts'

export interface Issued<T> {
  payload: T
  jws: string
}

function signPayload<T>(payload: T): Issued<T> {
  const key = ensureKeypair()
  if (!key.privateKey) throw new Error('no mandate private key available to this process')

  const jws = encode(
    { alg: 'EdDSA', typ: 'mandate+jws', kid: key.kid },
    payload as unknown,
    key.privateKey,
  )
  save(payload as never, jws)
  return { payload, jws }
}

export function issueIntent(opts: {
  subject: string
  agent: string
  scope: Partial<IntentScope> & { max_amount_paise: Paise }
  ttlSeconds?: number
}): Issued<IntentPayload> {
  const now = Math.floor(Date.now() / 1000)

  return signPayload<IntentPayload>({
    jti: mandateId(),
    kind: 'intent',
    sub: opts.subject,
    aud: MERCHANT.id,
    agent: opts.agent,
    scope: {
      max_amount_paise: opts.scope.max_amount_paise,
      currency: opts.scope.currency ?? MERCHANT.currency,
      categories: opts.scope.categories ?? null,
      max_uses: opts.scope.max_uses ?? null,
    },
    iat: now,
    exp: now + (opts.ttlSeconds ?? 3600),
  })
}

export function issueCart(opts: {
  subject: string
  agent: string
  intentJti: string
  sessionId: string
  cartHash: string
  amountPaise: Paise
  currency?: string
  ttlSeconds?: number
}): Issued<CartPayload> {
  const now = Math.floor(Date.now() / 1000)

  return signPayload<CartPayload>({
    jti: mandateId(),
    kind: 'cart',
    sub: opts.subject,
    aud: MERCHANT.id,
    agent: opts.agent,
    intent_jti: opts.intentJti,
    session_id: opts.sessionId,
    cart_hash: opts.cartHash,
    amount_paise: opts.amountPaise,
    currency: opts.currency ?? MERCHANT.currency,
    iat: now,
    exp: now + (opts.ttlSeconds ?? 300),
  })
}
