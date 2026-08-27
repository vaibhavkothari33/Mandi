import { append } from '@/lib/audit'
import { errorResponse } from '@/lib/http'
import { pay } from '@/lib/human'
import { ApiError } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const body = (await request.json()) as { claim_token?: string }
    if (!body.claim_token) throw new ApiError(400, 'claim_required', 'claim_token is required')

    const result = await pay(id, body.claim_token)
    return Response.json(result.body, { status: result.status })
  } catch (err) {
    return errorResponse(err)
  }
}
