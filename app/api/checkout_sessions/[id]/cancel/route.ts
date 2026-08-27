import { append } from '@/lib/audit'
import { ApiError, errorResponse } from '@/lib/http'
import { requestId } from '@/lib/ids'
import { get, serialize, update } from '@/lib/session/store'
import { isTerminal } from '@/lib/session/machine'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const reqId = request.headers.get('Request-Id') ?? requestId()
  const agentId = request.headers.get('Agent-Id')
  const { id } = await params

  try {
    const current = get(id)
    if (isTerminal(current.status)) {
      throw new ApiError(409, 'session_terminal', `session is already ${current.status}`)
    }

    const session = update(id, current.version, { status: 'canceled', quoteId: null })

    append({
      sessionId: id,
      actor: agentId ?? 'anonymous_agent',
      action: 'session.cancel',
      decision: 'allow',
      detail: { from: current.status },
    })

    return Response.json(serialize(session), { headers: { 'Request-Id': reqId } })
  } catch (err) {
    append({
      sessionId: id,
      actor: agentId ?? 'anonymous_agent',
      action: 'session.cancel',
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { message: (err as Error).message },
    })
    return errorResponse(err, reqId)
  }
}
