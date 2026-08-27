import { append } from '@/lib/audit'
import { errorResponse } from '@/lib/http'
import { startCheckout, WEB_BUYER } from '@/lib/human'
import { isCompleteFulfillment, type Fulfillment } from '@/lib/session/machine'
import { serialize } from '@/lib/session/store'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { items?: unknown; fulfillment?: Fulfillment }
    const fulfillment = isCompleteFulfillment(body.fulfillment) ? body.fulfillment : null
    const { session, claimToken } = startCheckout(body.items ?? [], fulfillment)

    append({
      sessionId: session.id,
      actor: WEB_BUYER,
      action: 'session.create',
      decision: 'allow',
      detail: { channel: 'web', items: session.items, totals: session.totals },
    })

    return Response.json({ ...serialize(session), claim_token: claimToken }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
