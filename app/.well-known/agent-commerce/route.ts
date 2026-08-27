import { LIMITS, MERCHANT, PROTOCOL, baseUrl } from '@/lib/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const base = baseUrl()

  return Response.json({
    protocol: PROTOCOL,
    merchant: MERCHANT,
    endpoints: {
      catalog: `${base}/api/catalog`,
      checkout_sessions: `${base}/api/checkout_sessions`,
      jwks: `${base}/.well-known/jwks.json`,
    },
    mandates: {
      accepted: ['intent', 'cart'],
      signing_alg: 'EdDSA',
      cart_mandate_single_use: true,
    },
    payment: {
      psp: 'razorpay',
      mode: 'test',
      methods: ['upi', 'card'],
    },
    limits: LIMITS,
  })
}
