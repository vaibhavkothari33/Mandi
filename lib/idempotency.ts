import { db, nowIso } from './db/client.ts'
import { hashOf } from './canonical.ts'
import { ApiError } from './http.ts'

export interface StoredResponse {
  status: number
  body: unknown
}

export const fingerprint = (method: string, path: string, body: string): string =>
  hashOf({ method: method.toUpperCase(), path, body })

/**
 * Claims a key before any work happens. The insert is the lock: a second
 * caller with the same key cannot proceed past this point.
 *
 * - same key, same request, response stored  -> replay the stored response
 * - same key, same request, no response yet  -> a duplicate is still in flight
 * - same key, different request              -> key reuse, refuse outright
 */
export function claim(key: string, endpoint: string, requestHash: string): StoredResponse | null {
  const existing = db().prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key) as
    | { request_hash: string; response_status: number | null; response_json: string | null }
    | undefined

  if (!existing) {
    try {
      db()
        .prepare(
          `INSERT INTO idempotency_keys (key, endpoint, request_hash, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(key, endpoint, requestHash, nowIso())
      return null
    } catch {
      throw new ApiError(409, 'request_in_progress', 'a request with this Idempotency-Key is in flight')
    }
  }

  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      422,
      'idempotency_key_reuse',
      'this Idempotency-Key was already used with a different request body',
      'Idempotency-Key',
    )
  }

  if (existing.response_status === null) {
    throw new ApiError(409, 'request_in_progress', 'a request with this Idempotency-Key is in flight')
  }

  return {
    status: existing.response_status,
    body: existing.response_json ? JSON.parse(existing.response_json) : null,
  }
}

export function record(key: string, status: number, body: unknown): void {
  db()
    .prepare('UPDATE idempotency_keys SET response_status = ?, response_json = ? WHERE key = ?')
    .run(status, JSON.stringify(body ?? null), key)
}

/** Releases a claim so a genuine server error does not poison the key forever. */
export function release(key: string): void {
  db().prepare('DELETE FROM idempotency_keys WHERE key = ? AND response_status IS NULL').run(key)
}
