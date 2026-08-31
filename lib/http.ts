export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly param?: string

  constructor(status: number, code: string, message: string, param?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.param = param
  }
}

const TYPE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limit',
  501: 'not_implemented',
}

/**
 * The gate lets a charge through with 200 when the provider confirmed capture
 * and 202 when it only accepted the instruction. Both mean "authorized"; only
 * the second leaves the session at `pending_payment`. Callers deciding whether
 * money was permitted to move must accept either.
 */
export const gateAllowed = (status: number): boolean => status === 200 || status === 202

export function errorResponse(err: unknown, requestId?: string): Response {
  const e =
    err instanceof ApiError ? err : new ApiError(500, 'internal_error', 'Unexpected server error')

  return Response.json(
    {
      error: {
        type: TYPE_BY_STATUS[e.status] ?? 'server_error',
        code: e.code,
        message: e.message,
        ...(e.param ? { param: e.param } : {}),
      },
    },
    { status: e.status, headers: requestId ? { 'Request-Id': requestId } : undefined },
  )
}
