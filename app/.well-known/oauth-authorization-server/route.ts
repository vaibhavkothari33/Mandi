import { configured, issuer, MCP_SCOPE } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export function GET(request: Request) {
  if (!configured()) return Response.json({ error: 'MCP OAuth is not configured' }, { status: 503 })
  const base = issuer(request)
  return Response.json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [MCP_SCOPE] })
}
