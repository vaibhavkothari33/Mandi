import { ApiError } from '@/lib/http'
import { authorize } from '@/lib/gate'
import { executor } from '@/lib/pay'
import { handleMutation } from '@/lib/route'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params

  return handleMutation({
    request,
    path: `/api/checkout_sessions/${id}/complete`,
    action: 'session.complete',
    sessionId: id,
    run: async (auth, body) => {
      const intentJws = body.intent_mandate
      const cartJws = body.cart_mandate

      if (typeof intentJws !== 'string' || typeof cartJws !== 'string') {
        throw new ApiError(
          400,
          'mandate_required',
          'intent_mandate and cart_mandate are required to complete a checkout',
        )
      }

      const result = await authorize(
        { sessionId: id, callerAgentId: auth.agentId, intentJws, cartJws },
        executor(),
        auth.idempotencyKey,
      )

      return { status: result.status, body: result.body }
    },
  })
}
