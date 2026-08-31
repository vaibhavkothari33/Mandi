import { configured, exchangeAuthorizationCode } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!configured()) return Response.json({ error: 'server_error' }, { status: 503 })
  const body = await request.formData()
  if (body.get('grant_type') !== 'authorization_code') return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
  const token = exchangeAuthorizationCode({ code: string(body, 'code'), clientId: string(body, 'client_id'), redirectUri: string(body, 'redirect_uri'), codeVerifier: string(body, 'code_verifier'), resource: string(body, 'resource') })
  return token ? Response.json(token, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }) : Response.json({ error: 'invalid_grant' }, { status: 400 })
}
function string(body: FormData, name: string): string | null { const value = body.get(name); return typeof value === 'string' ? value : null }
