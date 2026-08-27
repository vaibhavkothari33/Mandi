import type { CartItem } from '../catalog.ts'

export type SessionStatus =
  | 'not_ready_for_payment'
  | 'ready_for_payment'
  | 'completed'
  | 'canceled'

export interface Fulfillment {
  name: string
  line1: string
  line2?: string
  city: string
  state: string
  postal_code: string
  country: string
  phone?: string
}

const REQUIRED_FULFILLMENT: (keyof Fulfillment)[] = [
  'name',
  'line1',
  'city',
  'state',
  'postal_code',
  'country',
]

export const isTerminal = (status: SessionStatus): boolean =>
  status === 'completed' || status === 'canceled'

export function isCompleteFulfillment(f: Fulfillment | null | undefined): f is Fulfillment {
  if (!f) return false
  return REQUIRED_FULFILLMENT.every((k) => typeof f[k] === 'string' && String(f[k]).trim() !== '')
}

/**
 * Readiness is derived, never assigned. Any change to items or fulfillment
 * recomputes it, so a session cannot be left claiming to be payable.
 */
export function deriveStatus(
  current: SessionStatus,
  items: CartItem[],
  fulfillment: Fulfillment | null,
): SessionStatus {
  if (isTerminal(current)) return current
  const ready = items.length > 0 && isCompleteFulfillment(fulfillment)
  return ready ? 'ready_for_payment' : 'not_ready_for_payment'
}

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  not_ready_for_payment: ['not_ready_for_payment', 'ready_for_payment', 'canceled'],
  ready_for_payment: ['ready_for_payment', 'not_ready_for_payment', 'completed', 'canceled'],
  completed: [],
  canceled: [],
}

export const canTransition = (from: SessionStatus, to: SessionStatus): boolean =>
  ALLOWED[from].includes(to)
