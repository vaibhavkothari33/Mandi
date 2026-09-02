import { approveAndPay } from '@/lib/consent'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * The consent page's only write.
 *
 * Unauthenticated by design: the approval id in the emailed link is the
 * capability, the same way the web checkout's claim token is. It is generated
 * from a cryptographic source for that reason.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = (await request.json().catch(() => ({}))) as { confirmed_amount_paise?: number }
    const result = await approveAndPay(id, body.confirmed_amount_paise)

    return Response.json({
      ...result,
      key_id: result.outcome === 'authorized' ? (process.env.RAZORPAY_KEY_ID ?? null) : undefined,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
