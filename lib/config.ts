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
  quote_ttl_seconds: 120,
  max_items_per_cart: 20,
  max_quantity_per_item: 10,
  /** Quote is revalidated at completion; drift beyond this needs fresh consent. */
  price_drift_tolerance_bps: 0,
  request_timestamp_skew_seconds: 300,
} as const

export const baseUrl = () =>
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
