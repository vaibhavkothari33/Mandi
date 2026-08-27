import { ApiError } from '@/lib/http'
import { handleMutation } from '@/lib/route'
import { isTerminal } from '@/lib/session/machine'
import { get, serialize, update } from '@/lib/session/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params

  return handleMutation({
    request,
    path: `/api/checkout_sessions/${id}/cancel`,
    action: 'session.cancel',
    sessionId: id,
    run: () => {
      const current = get(id)
      if (isTerminal(current.status)) {
        throw new ApiError(409, 'session_terminal', `session is already ${current.status}`)
      }

      const session = update(id, current.version, { status: 'canceled', quoteId: null })
      return { status: 200, body: serialize(session) }
    },
  })
}
