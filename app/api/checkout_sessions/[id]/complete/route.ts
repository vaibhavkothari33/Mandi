import { ApiError } from '@/lib/http'
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
    // Completion stays refused until the mandate gate is wired. No money path
    // runs partially validated.
    run: () => {
      throw new ApiError(
        501,
        'gate_not_implemented',
        'completion requires the mandate gate, which is not yet enabled',
      )
    },
  })
}
