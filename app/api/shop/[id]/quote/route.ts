import { append } from '@/lib/audit'
import { errorResponse } from '@/lib/http'
import { quote, WEB_BUYER } from '@/lib/human'
import { serialize } from '@/lib/quote'
import { ApiError } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = (await request.json()) as { claim_token?: string }
    if (!body.claim_token) throw new ApiError(400, 'claim_required', 'claim_token is required')

    const issued = quote(id, body.claim_token)

    append({
      sessionId: id,
      actor: WEB_BUYER,
      action: 'session.quote',
      decision: 'allow',
      detail: { channel: 'web', quote: issued.id, total_paise: issued.total_paise },
    })

    return Response.json(serialize(issued), { status: 201 })
  } catch (err) {
    append({
      sessionId: id,
      actor: WEB_BUYER,
      action: 'session.quote',
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { channel: 'web' },
    })
    return errorResponse(err)
  }
}
