import { configured, registerClient } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!configured()) return Response.json({ error: 'MCP OAuth is not configured' }, { status: 503 })
  const client = registerClient(await request.json().catch(() => null))
  if (!client) return Response.json({ error: 'invalid_client_metadata' }, { status: 400 })
  return Response.json(client, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
