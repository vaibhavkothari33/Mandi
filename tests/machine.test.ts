import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransition,
  deriveStatus,
  isCompleteFulfillment,
  isTerminal,
} from '../lib/session/machine.ts'
import { ADDRESS } from './helpers.ts'

const ITEM = { product_id: 'sku_chai_250', quantity: 1, unit_price_paise: 24900 }

test('terminal states are terminal', () => {
  assert.equal(isTerminal('completed'), true)
  assert.equal(isTerminal('canceled'), true)
  assert.equal(isTerminal('ready_for_payment'), false)
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

test('completed and canceled admit no further transitions', () => {
  assert.equal(canTransition('ready_for_payment', 'completed'), true)
  assert.equal(canTransition('not_ready_for_payment', 'completed'), false)
  assert.equal(canTransition('completed', 'canceled'), false)
  assert.equal(canTransition('canceled', 'ready_for_payment'), false)
})
