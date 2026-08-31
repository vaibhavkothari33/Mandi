import { configured, issuer, MCP_SCOPE, resourceUrl } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export function GET(request: Request) {
  if (!configured()) return Response.json({ error: 'MCP OAuth is not configured' }, { status: 503 })
  return Response.json({ resource: resourceUrl(request), authorization_servers: [issuer(request)], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'] })
}
