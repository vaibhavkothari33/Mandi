import { createHmac, timingSafeEqual } from 'node:crypto'
import { sha256 } from './canonical.ts'

export const SIGNATURE_VERSION = 'v1'

/**
 * Signed material covers the timestamp, the verb, the path and a digest of the
 * body. Binding all four means a captured signature cannot be replayed against
 * a different route, verb, or payload.
 */
export function signingPayload(opts: {
  timestamp: string
  method: string
  path: string
  body: string
}): string {
  return [opts.timestamp, opts.method.toUpperCase(), opts.path, sha256(opts.body)].join('.')
}

export function sign(secret: string, payload: string): string {
  return `${SIGNATURE_VERSION}=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
}

/** Constant-time comparison; a fast reject would leak the expected digest. */
export function verify(secret: string, payload: string, presented: string): boolean {
  const expected = sign(secret, payload)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
