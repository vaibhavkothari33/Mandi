/** Integer paise. Rupees exist only at the display edge. */
export type Paise = number

export function assertPaise(n: unknown, label = 'amount'): asserts n is Paise {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer in paise, got ${String(n)}`)
  }
}

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100)

export function formatInr(paise: Paise): string {
  assertPaise(paise)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paise / 100)
}
