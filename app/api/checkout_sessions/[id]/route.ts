import { errorResponse } from '@/lib/http'
import { requestId } from '@/lib/ids'
import { handleMutation } from '@/lib/route'
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
  const { id } = await params

  return handleMutation({
    request,
    path: `/api/checkout_sessions/${id}`,
    action: 'session.update',
    sessionId: id,
    run: (_auth, body) => {
      const current = get(id)
      const patch: { items?: ReturnType<typeof resolveItems>; fulfillment?: Fulfillment | null } = {}

      if (body.items !== undefined) patch.items = resolveItems(body.items)
      if (body.fulfillment !== undefined) {
        patch.fulfillment = isCompleteFulfillment(body.fulfillment as Fulfillment)
          ? (body.fulfillment as Fulfillment)
          : null
      }

      // Any mutation invalidates an outstanding quote; it must be re-issued.
      const session = update(id, current.version, { ...patch, quoteId: null })
      return { status: 200, body: serialize(session) }
    },
  })
}
