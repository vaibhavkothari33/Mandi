import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { registerTools } from '@/mcp/tools'
import { configured as oauthConfigured, issuer, resourceUrl, verifyAccessToken } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Remote MCP endpoint, for clients that cannot spawn a local process — Claude
 * on the web reaches servers over HTTPS from Anthropic's infrastructure, not
 * from the user's machine.
 *
 * This surface can create payment instructions, so it is disabled unless
 * MCP_BEARER_TOKEN is set. Failing closed matters more here than convenience:
 * an unauthenticated endpoint on a public tunnel is reachable by anyone who
 * guesses the URL.
 */
function authorized(request: Request): boolean {
  const expected = process.env.MCP_BEARER_TOKEN
  const presented = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (expected) {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(presented, 'utf8')
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return oauthConfigured() && verifyAccessToken(presented, resourceUrl(request))
}

function refuse(request: Request): Response {
  const configured = Boolean(process.env.MCP_BEARER_TOKEN) || oauthConfigured()

  return Response.json(
    {
      error: {
        code: configured ? 'unauthorized' : 'remote_mcp_disabled',
        message: configured
          ? 'a valid bearer token is required'
          : 'set MCP_BEARER_TOKEN to enable the remote MCP endpoint',
      },
    },
    { status: configured ? 401 : 503, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${issuer(request)}/.well-known/oauth-protected-resource/api/mcp", scope="mandi.tools"` } },
  )
}

/** Stateless: a fresh server and transport per request, so no state is pinned to one instance. */
async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) return refuse(request)

  const server = registerTools(new McpServer({ name: 'mandi-buyer', version: '0.1.0' }))
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  await server.connect(transport)

  // The returned Response streams its body, so the server must outlive this
  // function. Closing it here truncates the stream before anything is written.
  transport.onclose = () => {
    void server.close()
  }

  return transport.handleRequest(request)
}

export const POST = handle
export const GET = handle
export const DELETE = handle
