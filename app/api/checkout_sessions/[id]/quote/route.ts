import { ApiError } from '@/lib/http'
import { handleMutation } from '@/lib/route'
import { detectDrift, issue, serialize } from '@/lib/quote'
import { get, update } from '@/lib/session/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params

  return handleMutation({
    request,
    path: `/api/checkout_sessions/${id}/quote`,
    action: 'session.quote',
    sessionId: id,
    run: () => {
      const session = get(id)

      if (session.status !== 'ready_for_payment') {
        throw new ApiError(409, 'session_not_payable', `session is ${session.status}`)
      }

      // A quote is only meaningful if it reflects the catalogue right now.
      const drift = detectDrift(session.items)
      if (drift.length > 0) {
        throw new ApiError(409, 'catalog_changed', 'the catalogue moved before this quote could be issued')
      }

      const quote = issue(session)
      update(id, session.version, { quoteId: quote.id })

      return { status: 201, body: serialize(quote) }
    },
  })
}
