import { append } from '@/lib/audit'
import { ApiError, errorResponse } from '@/lib/http'
import { requestId } from '@/lib/ids'
import { create, resolveItems, serialize } from '@/lib/session/store'
import { isCompleteFulfillment, type Fulfillment } from '@/lib/session/machine'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const reqId = request.headers.get('Request-Id') ?? requestId()
  const agentId = request.headers.get('Agent-Id')

  try {
    const body = (await request.json().catch(() => {
      throw new ApiError(400, 'invalid_json', 'request body must be valid JSON')
    })) as { items?: unknown; fulfillment?: Fulfillment }

    const items = resolveItems(body.items ?? [])
    const fulfillment = isCompleteFulfillment(body.fulfillment) ? body.fulfillment : null
    const session = create({ agentId, items, fulfillment })

    append({
      sessionId: session.id,
      actor: agentId ?? 'anonymous_agent',
      action: 'session.create',
      decision: 'allow',
      detail: { items: session.items, status: session.status, totals: session.totals },
    })

    return Response.json(serialize(session), { status: 201, headers: { 'Request-Id': reqId } })
  } catch (err) {
    append({
      actor: agentId ?? 'anonymous_agent',
      action: 'session.create',
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { message: (err as Error).message },
    })
    return errorResponse(err, reqId)
  }
}
