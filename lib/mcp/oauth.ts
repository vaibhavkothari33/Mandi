import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db, nowIso } from '@/lib/db/client'

const g = globalThis as unknown as {
  __mandiOAuthClients?: Map<string, OAuthClient>
  __mandiOAuthCodes?: Map<string, AuthorizationCode>
}

interface OAuthClient { redirectUris: string[]; name: string }
interface AuthorizationCode { clientId: string; redirectUri: string; codeChallenge: string; resource: string; expiresAt: number }
interface AccessTokenPayload { aud: string; exp: number; scope: string }

const clients = () => (g.__mandiOAuthClients ??= new Map<string, OAuthClient>())
const codes = () => (g.__mandiOAuthCodes ??= new Map<string, AuthorizationCode>())

export const MCP_SCOPE = 'mandi.tools'
export function issuer(request: Request): string {
  const configuredUrl = process.env.MCP_PUBLIC_BASE_URL
  if (configuredUrl) return new URL(configuredUrl).origin
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (host) return `${forwardedProtocol || new URL(request.url).protocol.replace(':', '')}://${host}`
  return new URL(request.url).origin
}
export const resourceUrl = (request: Request) => `${issuer(request)}/api/mcp`
export const configured = () => Boolean(process.env.MCP_OAUTH_APPROVAL_TOKEN && process.env.MCP_OAUTH_SIGNING_SECRET)

export function registerClient(input: unknown): {
  client_id: string
  client_id_issued_at: number
  redirect_uris: string[]
  client_name: string
  token_endpoint_auth_method: 'none'
  grant_types: string[]
  response_types: string[]
} | null {
  const body = input as { client_name?: unknown; redirect_uris?: unknown }
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0 || !body.redirect_uris.every(validRedirectUri)) return null
  const clientId = randomBytes(24).toString('base64url')
  const client = { name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : 'MCP client', redirectUris: body.redirect_uris }
  clients().set(clientId, client)
  db().prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)').run(clientId, client.name, JSON.stringify(client.redirectUris), nowIso())
  // RFC 7591 requires the complete client information document in the
  // registration response, not merely the generated client identifier.
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: client.redirectUris,
    client_name: client.name,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }
}

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) } catch { return false }
}

export function validateAuthorization(input: { clientId: string | null; redirectUri: string | null; responseType: string | null; codeChallenge: string | null; codeChallengeMethod: string | null; resource: string | null; expectedResource: string }): string | null {
  const client = input.clientId ? getClient(input.clientId) : undefined
  if (!client || !input.redirectUri || !client.redirectUris.includes(input.redirectUri)) return 'invalid client or redirect URI'
  if (input.responseType !== 'code') return 'only response_type=code is supported'
  if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') return 'PKCE with S256 is required'
  if (input.resource !== input.expectedResource) return 'the requested resource does not match this MCP server'
  return null
}

function getClient(clientId: string): OAuthClient | undefined {
  const cached = clients().get(clientId)
  if (cached) return cached
  const row = db().prepare('SELECT name, redirect_uris FROM oauth_clients WHERE id = ?').get(clientId) as { name: string; redirect_uris: string } | undefined
  if (!row) return undefined
  try {
    const redirectUris = JSON.parse(row.redirect_uris) as unknown
    if (!Array.isArray(redirectUris) || !redirectUris.every(validRedirectUri)) return undefined
    const client = { name: row.name, redirectUris }
    clients().set(clientId, client)
    return client
  } catch { return undefined }
}

export function issueAuthorizationCode(input: Omit<AuthorizationCode, 'expiresAt'>): string {
  const code = randomBytes(32).toString('base64url')
  codes().set(code, { ...input, expiresAt: Date.now() + 5 * 60_000 })
  return code
}

export function exchangeAuthorizationCode(input: { code: string | null; clientId: string | null; redirectUri: string | null; codeVerifier: string | null; resource: string | null }): { access_token: string; token_type: 'Bearer'; expires_in: number; scope: string } | null {
  if (!input.code) return null
  const code = codes().get(input.code); codes().delete(input.code)
  if (!code || code.expiresAt < Date.now() || code.clientId !== input.clientId || code.redirectUri !== input.redirectUri || code.resource !== input.resource || !input.codeVerifier || !constantTimeEqual(code.codeChallenge, sha256(input.codeVerifier))) return null
  const expiresIn = 60 * 60
  return { access_token: sign({ aud: code.resource, exp: Math.floor(Date.now() / 1000) + expiresIn, scope: MCP_SCOPE }), token_type: 'Bearer', expires_in: expiresIn, scope: MCP_SCOPE }
}

export function verifyAccessToken(token: string, audience: string): boolean {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature || token.split('.').length !== 2 || !constantTimeEqual(signature, mac(encoded))) return false
  try { const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AccessTokenPayload; return payload.aud === audience && payload.exp > Math.floor(Date.now() / 1000) && payload.scope.split(' ').includes(MCP_SCOPE) } catch { return false }
}

export function approvalMatches(value: string): boolean {
  const expected = process.env.MCP_OAUTH_APPROVAL_TOKEN
  return Boolean(expected && constantTimeEqual(value, expected))
}

function sign(payload: AccessTokenPayload): string { const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${encoded}.${mac(encoded)}` }
function mac(value: string): string { return createHmac('sha256', process.env.MCP_OAUTH_SIGNING_SECRET ?? '').update(value).digest('base64url') }
function sha256(value: string): string { return createHash('sha256').update(value).digest('base64url') }
function constantTimeEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
