export const MERCHANT = {
  id: process.env.MERCHANT_ID ?? 'mrc_mandi_demo',
  name: process.env.MERCHANT_NAME ?? 'Mandi Provisions',
  currency: 'INR',
} as const

export const PROTOCOL = {
  checkout: 'acp-shaped/2026-08',
  mandates: 'ap2-inspired/v0',
  api_version: '2026-08-01',
} as const

export const LIMITS = {
  /**
   * Long enough for a human to read an emailed approval request and act on it.
   * The consent page relocks an expired price rather than refusing, so this is
   * about how often that happens, not whether a late buyer can still pay.
   */
  quote_ttl_seconds: 300,
  max_items_per_cart: 20,
  max_quantity_per_item: 10,
  /** Quote is revalidated at completion; drift beyond this needs fresh consent. */
  price_drift_tolerance_bps: 0,
  request_timestamp_skew_seconds: 300,
} as const

/**
 * A Razorpay test card that this account can actually charge.
 *
 * The widely quoted `4111 1111 1111 1111` is an international card, and an
 * account without cross-border payments enabled refuses it outright with
 * "International cards are not supported" — so the domestic Visa debit number
 * from Razorpay's test-card list is the one shown to buyers.
 */
export const TEST_CARD = '4100 2800 0000 1007'

export const baseUrl = () =>
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
