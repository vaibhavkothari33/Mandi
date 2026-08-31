import { approvalMatches, configured, issueAuthorizationCode, resourceUrl, validateAuthorization } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
const fields = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'state'] as const
const text = (input: FormData | URLSearchParams, name: string) => String(input.get(name) ?? '')

function form(request: Request, message = ''): Response {
  const url = new URL(request.url)
  const hidden = fields.map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(url.searchParams.get(name) ?? '')}">`).join('')
  const body = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Mandi</title></head><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>Connect Claude to Mandi</h1><p>Approve this connection to let Claude use Mandi buyer tools for one hour.</p>${message ? `<p style="color:#b42318">${escapeHtml(message)}</p>` : ''}<form method="post">${hidden}<label>Connection approval token<br><input name="approval_token" type="password" required autocomplete="off" style="width:100%;margin:0.5rem 0 1rem;padding:0.5rem"></label><br><button type="submit">Approve connection</button></form></body></html>`
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function requestError(params: URLSearchParams | FormData, expectedResource: string): string | null {
  return validateAuthorization({ clientId: text(params, 'client_id'), redirectUri: text(params, 'redirect_uri'), responseType: text(params, 'response_type'), codeChallenge: text(params, 'code_challenge'), codeChallengeMethod: text(params, 'code_challenge_method'), resource: text(params, 'resource'), expectedResource })
}

export function GET(request: Request) {
  if (!configured()) return new Response('MCP OAuth is not configured', { status: 503 })
  const error = requestError(new URL(request.url).searchParams, resourceUrl(request))
  return error ? new Response(`Invalid authorization request: ${error}`, { status: 400 }) : form(request)
}

export async function POST(request: Request) {
  if (!configured()) return new Response('MCP OAuth is not configured', { status: 503 })
  const body = await request.formData()
  const expectedResource = resourceUrl(request)
  const error = requestError(body, expectedResource)
  if (error) return new Response(`Invalid authorization request: ${error}`, { status: 400 })
  if (!approvalMatches(text(body, 'approval_token'))) return form(request, 'That approval token is not valid.')
  const code = issueAuthorizationCode({ clientId: text(body, 'client_id'), redirectUri: text(body, 'redirect_uri'), codeChallenge: text(body, 'code_challenge'), resource: expectedResource })
  const redirect = new URL(text(body, 'redirect_uri'))
  redirect.searchParams.set('code', code)
  const state = text(body, 'state')
  if (state) redirect.searchParams.set('state', state)
  return Response.redirect(redirect, 302)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!)
}
