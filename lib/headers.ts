import { getAgent } from './agents.ts'
import { LIMITS, PROTOCOL } from './config.ts'
import { ApiError } from './http.ts'
import { requestId as newRequestId } from './ids.ts'
import { signingPayload, verify } from './signing.ts'

export interface AuthedRequest {
  agentId: string
  requestId: string
  idempotencyKey: string
  timestamp: string
}

function required(request: Request, name: string): string {
  const value = request.headers.get(name)
  if (!value) throw new ApiError(400, 'missing_header', `${name} header is required`, name)
  return value
}

function assertFreshTimestamp(raw: string): void {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds)) {
    throw new ApiError(400, 'invalid_timestamp', 'Timestamp must be unix seconds', 'Timestamp')
  }

  const skew = Math.abs(Date.now() / 1000 - seconds)
  if (skew > LIMITS.request_timestamp_skew_seconds) {
    throw new ApiError(
      401,
      'stale_timestamp',
      `Timestamp is ${Math.round(skew)}s away from server time; limit is ${LIMITS.request_timestamp_skew_seconds}s`,
      'Timestamp',
    )
  }
}

/**
 * Authenticates a mutating request. Every failure mode is distinct so the
 * audit log records which check refused, not merely that one did.
 */
export function authenticate(request: Request, rawBody: string, path: string): AuthedRequest {
  const version = request.headers.get('API-Version')
  if (version && version !== PROTOCOL.api_version) {
    throw new ApiError(400, 'unsupported_api_version', `this merchant speaks ${PROTOCOL.api_version}`, 'API-Version')
  }

  const agentId = required(request, 'Agent-Id')
  const timestamp = required(request, 'Timestamp')
  const signature = required(request, 'Signature')
  const idempotencyKey = required(request, 'Idempotency-Key')

  assertFreshTimestamp(timestamp)

  const agent = getAgent(agentId)
  if (!agent) throw new ApiError(401, 'unknown_agent', `no registered agent ${agentId}`, 'Agent-Id')
  if (!agent.active) throw new ApiError(403, 'agent_disabled', `agent ${agentId} is disabled`, 'Agent-Id')

  const payload = signingPayload({ timestamp, method: request.method, path, body: rawBody })
  if (!verify(agent.secret, payload, signature)) {
    throw new ApiError(401, 'invalid_signature', 'Signature does not match request', 'Signature')
  }

  return {
    agentId,
    requestId: request.headers.get('Request-Id') ?? newRequestId(),
    idempotencyKey,
    timestamp,
  }
}
