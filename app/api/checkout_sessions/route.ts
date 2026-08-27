import { handleMutation } from '@/lib/route'
import { create, resolveItems, serialize } from '@/lib/session/store'
import { isCompleteFulfillment, type Fulfillment } from '@/lib/session/machine'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleMutation({
    request,
    path: '/api/checkout_sessions',
    action: 'session.create',
    run: (auth, body) => {
      const items = resolveItems(body.items ?? [])
      const fulfillment = isCompleteFulfillment(body.fulfillment as Fulfillment)
        ? (body.fulfillment as Fulfillment)
        : null

      const session = create({ agentId: auth.agentId, items, fulfillment })
      return { status: 201, body: serialize(session) }
    },
  })
}
