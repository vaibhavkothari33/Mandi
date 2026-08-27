import { append } from '@/lib/audit'
import { errorResponse } from '@/lib/http'
import { setFulfillment, WEB_BUYER } from '@/lib/human'
import { isCompleteFulfillment, type Fulfillment } from '@/lib/session/machine'
import { serialize } from '@/lib/session/store'
import { ApiError } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = (await request.json()) as { claim_token?: string; fulfillment?: Fulfillment }
    if (!body.claim_token) throw new ApiError(400, 'claim_required', 'claim_token is required')
    if (!isCompleteFulfillment(body.fulfillment)) {
      throw new ApiError(400, 'incomplete_address', 'every address field is required')
    }

    const session = setFulfillment(id, body.claim_token, body.fulfillment)

    append({
      sessionId: id,
      actor: WEB_BUYER,
      action: 'session.update',
      decision: 'allow',
      detail: { channel: 'web', status: session.status },
    })

    return Response.json(serialize(session))
  } catch (err) {
    return errorResponse(err)
  }
}
