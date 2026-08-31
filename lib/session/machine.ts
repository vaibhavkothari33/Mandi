import type { CartItem } from '../catalog.ts'

/**
 * `pending_payment` is the gap between authorising a charge and knowing it
 * landed. The session is locked there: the cart mandate is already burnt and
 * the provider holds an instruction, but no money is confirmed moved. Only a
 * capture confirmation advances it to `completed`.
 */
export type SessionStatus =
  | 'not_ready_for_payment'
  | 'ready_for_payment'
  | 'pending_payment'
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

/** Terminal, or in flight with the provider. Either way the cart is frozen. */
export const isLocked = (status: SessionStatus): boolean =>
  isTerminal(status) || status === 'pending_payment'

export function isCompleteFulfillment(f: Fulfillment | null | undefined): f is Fulfillment {
  if (!f) return false
  return REQUIRED_FULFILLMENT.every((k) => typeof f[k] === 'string' && String(f[k]).trim() !== '')
}

/**
 * Readiness is derived, never assigned. Any change to items or fulfillment
 * recomputes it, so a session cannot be left claiming to be payable.
 *
 * A locked session keeps its status: a charge in flight must not be talked
 * back into `ready_for_payment` by an edit arriving mid-capture.
 */
export function deriveStatus(
  current: SessionStatus,
  items: CartItem[],
  fulfillment: Fulfillment | null,
): SessionStatus {
  if (isLocked(current)) return current
  const ready = items.length > 0 && isCompleteFulfillment(fulfillment)
  return ready ? 'ready_for_payment' : 'not_ready_for_payment'
}

/**
 * `completed` is reachable only from `pending_payment`, so every sale passes
 * through the state that says "instruction issued, capture unconfirmed".
 * A provider that definitively declines sends the session back to
 * `ready_for_payment` for another attempt.
 */
const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  not_ready_for_payment: ['not_ready_for_payment', 'ready_for_payment', 'canceled'],
  ready_for_payment: ['ready_for_payment', 'not_ready_for_payment', 'pending_payment', 'canceled'],
  pending_payment: ['pending_payment', 'ready_for_payment', 'completed', 'canceled'],
  completed: [],
  canceled: [],
}

export const canTransition = (from: SessionStatus, to: SessionStatus): boolean =>
  ALLOWED[from].includes(to)
