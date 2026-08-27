import type { Paise } from '../money.ts'

export interface IntentScope {
  max_amount_paise: Paise
  currency: string
  categories: string[] | null
  max_uses: number | null
}

export interface IntentPayload {
  jti: string
  kind: 'intent'
  sub: string
  aud: string
  agent: string
  scope: IntentScope
  iat: number
  exp: number
}

export interface CartPayload {
  jti: string
  kind: 'cart'
  sub: string
  aud: string
  agent: string
  intent_jti: string
  session_id: string
  cart_hash: string
  amount_paise: Paise
  currency: string
  iat: number
  exp: number
}

export type MandatePayload = IntentPayload | CartPayload
