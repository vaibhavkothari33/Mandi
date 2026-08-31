import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransition,
  deriveStatus,
  isCompleteFulfillment,
  isLocked,
  isTerminal,
} from '../lib/session/machine.ts'
import { ADDRESS } from './helpers.ts'

const ITEM = { product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }

test('terminal states are terminal', () => {
  assert.equal(isTerminal('completed'), true)
  assert.equal(isTerminal('canceled'), true)
  assert.equal(isTerminal('ready_for_payment'), false)
  assert.equal(isTerminal('pending_payment'), false)
})

test('a payment in flight locks the session without ending it', () => {
  assert.equal(isLocked('pending_payment'), true)
  assert.equal(isLocked('completed'), true)
  assert.equal(isLocked('ready_for_payment'), false)
})

test('fulfillment requires every mandatory field', () => {
  assert.equal(isCompleteFulfillment(ADDRESS), true)
  assert.equal(isCompleteFulfillment({ ...ADDRESS, city: '  ' }), false)
  assert.equal(isCompleteFulfillment(null), false)
})

test('readiness is derived from items and address', () => {
  assert.equal(deriveStatus('not_ready_for_payment', [], null), 'not_ready_for_payment')
  assert.equal(deriveStatus('not_ready_for_payment', [ITEM], null), 'not_ready_for_payment')
  assert.equal(deriveStatus('not_ready_for_payment', [], ADDRESS), 'not_ready_for_payment')
  assert.equal(deriveStatus('not_ready_for_payment', [ITEM], ADDRESS), 'ready_for_payment')
})

test('a terminal session never re-derives to payable', () => {
  assert.equal(deriveStatus('completed', [ITEM], ADDRESS), 'completed')
  assert.equal(deriveStatus('canceled', [ITEM], ADDRESS), 'canceled')
})

test('a pending session never re-derives, in either direction', () => {
  assert.equal(deriveStatus('pending_payment', [ITEM], ADDRESS), 'pending_payment')
  assert.equal(deriveStatus('pending_payment', [], null), 'pending_payment')
})

test('completed and canceled admit no further transitions', () => {
  assert.equal(canTransition('not_ready_for_payment', 'completed'), false)
  assert.equal(canTransition('completed', 'canceled'), false)
  assert.equal(canTransition('canceled', 'ready_for_payment'), false)
})

test('completion is reachable only through pending_payment', () => {
  assert.equal(canTransition('ready_for_payment', 'pending_payment'), true)
  assert.equal(canTransition('pending_payment', 'completed'), true)

  // No shortcut: a session cannot be declared sold without first declaring
  // that an instruction went out to the provider.
  assert.equal(canTransition('ready_for_payment', 'completed'), false)
  assert.equal(canTransition('not_ready_for_payment', 'pending_payment'), false)
})

test('a declined payment returns a pending session to payable', () => {
  assert.equal(canTransition('pending_payment', 'ready_for_payment'), true)
  assert.equal(canTransition('pending_payment', 'canceled'), true)
  assert.equal(canTransition('pending_payment', 'not_ready_for_payment'), false)
})
