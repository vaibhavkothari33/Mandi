import { MERCHANT } from '../config.ts'
import { decode, verifySignature } from './jws.ts'
import { publicKeyFor } from './keys.ts'
import { byJti } from './store.ts'
import type { CartPayload, IntentPayload, MandatePayload } from './types.ts'

export type Verdict<T> = { ok: true; payload: T } | { ok: false; code: string; message: string }

const refuse = <T>(code: string, message: string): Verdict<T> => ({ ok: false, code, message })

const CLOCK_SKEW_SECONDS = 60

/**
 * Verification order is deliberate: cheap structural checks first, signature
 * before any use of payload contents, and registration last. Nothing in the
 * payload is trusted until the signature has been confirmed.
 */
export function verifyMandate<T extends MandatePayload>(
  jws: string,
  expected: 'intent' | 'cart',
): Verdict<T> {
  let decoded
  try {
    decoded = decode(jws)
  } catch {
    return refuse('mandate_malformed', 'mandate is not a well-formed compact JWS')
  }

  const { header, payload } = decoded

  if (header.alg !== 'EdDSA') return refuse('mandate_bad_alg', `unsupported algorithm ${header.alg}`)
  if (header.typ !== 'mandate+jws') return refuse('mandate_bad_type', `unexpected type ${header.typ}`)

  const publicKey = header.kid ? publicKeyFor(header.kid) : null
  if (!publicKey) return refuse('mandate_unknown_key', `unknown signing key ${header.kid}`)

  if (!verifySignature(jws, publicKey)) {
    return refuse('mandate_bad_signature', 'mandate signature does not verify')
  }

  if (payload.kind !== expected) {
    return refuse('mandate_wrong_kind', `expected a ${expected} mandate, got ${String(payload.kind)}`)
  }

  if (payload.aud !== MERCHANT.id) {
    return refuse('mandate_wrong_merchant', `mandate is addressed to ${String(payload.aud)}`)
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = Number(payload.exp)
  const iat = Number(payload.iat)

  if (!Number.isFinite(exp) || !Number.isFinite(iat)) {
    return refuse('mandate_bad_times', 'mandate iat/exp are not numeric')
  }
  if (now > exp) return refuse('mandate_expired', `mandate expired ${now - exp}s ago`)
  if (iat > now + CLOCK_SKEW_SECONDS) return refuse('mandate_not_yet_valid', 'mandate iat is in the future')

  const registered = byJti(String(payload.jti))
  if (!registered) return refuse('mandate_unregistered', 'mandate is not known to this merchant')
  if (registered.jws !== jws) {
    return refuse('mandate_substituted', 'a different mandate is registered under this identifier')
  }
  if (registered.consumed_at) {
    return refuse('mandate_already_used', `mandate was consumed at ${registered.consumed_at}`)
  }

  return { ok: true, payload: payload as unknown as T }
}

export const verifyIntent = (jws: string): Verdict<IntentPayload> =>
  verifyMandate<IntentPayload>(jws, 'intent')

export const verifyCart = (jws: string): Verdict<CartPayload> =>
  verifyMandate<CartPayload>(jws, 'cart')
