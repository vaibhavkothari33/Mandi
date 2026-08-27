import { append } from '@/lib/audit'
import { ApiError, errorResponse } from '@/lib/http'
import { requestId } from '@/lib/ids'
import { get, resolveItems, serialize, update } from '@/lib/session/store'
import { isCompleteFulfillment, type Fulfillment } from '@/lib/session/machine'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const reqId = request.headers.get('Request-Id') ?? requestId()
  try {
    const { id } = await params
    return Response.json(serialize(get(id)), { headers: { 'Request-Id': reqId } })
  } catch (err) {
    return errorResponse(err, reqId)
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const reqId = request.headers.get('Request-Id') ?? requestId()
  const agentId = request.headers.get('Agent-Id')
  const { id } = await params

  try {
    const body = (await request.json().catch(() => {
      throw new ApiError(400, 'invalid_json', 'request body must be valid JSON')
    })) as { items?: unknown; fulfillment?: Fulfillment | null }

    const current = get(id)
    const patch: { items?: ReturnType<typeof resolveItems>; fulfillment?: Fulfillment | null } = {}

    if (body.items !== undefined) patch.items = resolveItems(body.items)
    if (body.fulfillment !== undefined) {
      patch.fulfillment = isCompleteFulfillment(body.fulfillment) ? body.fulfillment : null
    }

    // Any mutation invalidates an outstanding quote; it must be re-issued.
    const session = update(id, current.version, { ...patch, quoteId: null })

    append({
      sessionId: id,
      actor: agentId ?? 'anonymous_agent',
      action: 'session.update',
      decision: 'allow',
      detail: { patch: Object.keys(patch), status: session.status, totals: session.totals },
    })

    return Response.json(serialize(session), { headers: { 'Request-Id': reqId } })
  } catch (err) {
    append({
      sessionId: id,
      actor: agentId ?? 'anonymous_agent',
      action: 'session.update',
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { message: (err as Error).message },
    })
    return errorResponse(err, reqId)
  }
}
