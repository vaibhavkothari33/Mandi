import { stats } from '@/lib/merchant'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(stats(), { headers: { 'Cache-Control': 'no-store' } })
}
