import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceCart, SHIPPING_FLAT_PAISE } from '../lib/pricing.ts'

const item = (unit: number, qty = 1) => ({ product_id: 'x', quantity: qty, unit_price_paise: unit })

test('empty cart costs nothing, including shipping', () => {
  assert.deepEqual(priceCart([]), {
    items_paise: 0,
    shipping_paise: 0,
    tax_paise: 0,
    total_paise: 0,
  })
})

test('shipping applies below the threshold and is waived above it', () => {
  assert.equal(priceCart([item(10000)]).shipping_paise, SHIPPING_FLAT_PAISE)
  assert.equal(priceCart([item(60000)]).shipping_paise, 0)
})

test('totals stay integers under awkward GST rounding', () => {
  const totals = priceCart([item(333, 3)])
  assert.equal(totals.items_paise, 999)
  assert.equal(totals.tax_paise, 50)
  assert.ok(Number.isInteger(totals.total_paise))
  assert.equal(totals.total_paise, 999 + SHIPPING_FLAT_PAISE + 50)
})

test('quantity multiplies before tax', () => {
  assert.equal(priceCart([item(24900, 2)]).items_paise, 49800)
})
