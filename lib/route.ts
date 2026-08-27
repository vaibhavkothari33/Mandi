import { append } from './audit.ts'
import { authenticate, type AuthedRequest } from './headers.ts'
import { ApiError, errorResponse } from './http.ts'
import { claim, fingerprint, record, release } from './idempotency.ts'

export interface MutationResult {
  status: number
  body: unknown
}

/**
 * One pipeline for every money-adjacent request: authenticate, claim the
 * idempotency key, run, then persist the outcome and audit it.
 *
 * Deterministic refusals (4xx) are recorded, so replaying a refused request
 * returns the same refusal. Server faults (5xx) release the key, so a
 * transient error does not permanently burn it.
 */
export async function handleMutation(opts: {
  request: Request
  path: string
  action: string
  sessionId?: string | null
  run: (auth: AuthedRequest, body: Record<string, unknown>) => MutationResult
}): Promise<Response> {
  const { request, path, action } = opts
  const rawBody = await request.text()

  let auth: AuthedRequest
  try {
    auth = authenticate(request, rawBody, path)
  } catch (err) {
    append({
      sessionId: opts.sessionId ?? null,
      actor: request.headers.get('Agent-Id') ?? 'unidentified',
      action,
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { stage: 'authenticate' },
    })
    return errorResponse(err)
  }

  const headers = { 'Request-Id': auth.requestId, 'Idempotency-Key': auth.idempotencyKey }

  try {
    const replayed = claim(auth.idempotencyKey, path, fingerprint(request.method, path, rawBody))
    if (replayed) {
      append({
        sessionId: opts.sessionId ?? null,
        actor: auth.agentId,
        action,
        decision: 'info',
        reason: 'idempotent_replay',
        detail: { status: replayed.status },
      })
      return Response.json(replayed.body, {
        status: replayed.status,
        headers: { ...headers, 'Idempotent-Replay': 'true' },
      })
    }
  } catch (err) {
    append({
      sessionId: opts.sessionId ?? null,
      actor: auth.agentId,
      action,
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { stage: 'idempotency' },
    })
    return errorResponse(err, auth.requestId)
  }

  let body: Record<string, unknown> = {}
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    const err = new ApiError(400, 'invalid_json', 'request body must be valid JSON')
    record(auth.idempotencyKey, err.status, { error: { code: err.code, message: err.message } })
    append({
      sessionId: opts.sessionId ?? null,
      actor: auth.agentId,
      action,
      decision: 'refuse',
      reason: err.code,
      detail: { stage: 'parse' },
    })
    return errorResponse(err, auth.requestId)
  }

  try {
    const result = opts.run(auth, body)
    record(auth.idempotencyKey, result.status, result.body)
    append({
      sessionId: opts.sessionId ?? null,
      actor: auth.agentId,
      action,
      decision: 'allow',
      detail: { status: result.status },
    })
    return Response.json(result.body, { status: result.status, headers })
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500
    if (status >= 500) release(auth.idempotencyKey)
    else {
      const e = err as ApiError
      record(auth.idempotencyKey, status, { error: { type: 'error', code: e.code, message: e.message } })
    }

    append({
      sessionId: opts.sessionId ?? null,
      actor: auth.agentId,
      action,
      decision: 'refuse',
      reason: err instanceof ApiError ? err.code : 'internal_error',
      detail: { stage: 'execute', message: (err as Error).message },
    })
    return errorResponse(err, auth.requestId)
  }
}
