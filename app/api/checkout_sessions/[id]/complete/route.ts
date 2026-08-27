import { append } from '@/lib/audit'
import { ApiError, errorResponse } from '@/lib/http'
import { requestId } from '@/lib/ids'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Completion is refused until the mandate gate is wired. No money path runs
 * partially validated.
 */
export async function POST(request: Request, { params }: Ctx) {
  const reqId = request.headers.get('Request-Id') ?? requestId()
  const agentId = request.headers.get('Agent-Id')
  const { id } = await params

  const err = new ApiError(
    501,
    'gate_not_implemented',
    'completion requires the mandate gate, which is not yet enabled',
  )

  append({
    sessionId: id,
    actor: agentId ?? 'anonymous_agent',
    action: 'session.complete',
    decision: 'refuse',
    reason: err.code,
    detail: { stage: 'pre_gate' },
  })

  return errorResponse(err, reqId)
}
