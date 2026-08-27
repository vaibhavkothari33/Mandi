import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'

export const b64u = (input: Buffer | string): string =>
  Buffer.from(input as never).toString('base64url')

export const fromB64u = (input: string): Buffer => Buffer.from(input, 'base64url')

export interface JwsHeader {
  alg: 'EdDSA'
  typ: 'mandate+jws'
  kid: string
}

export function privateKeyFrom(base64Der: string) {
  return createPrivateKey({
    key: Buffer.from(base64Der, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
}

export function publicKeyFrom(base64Der: string) {
  return createPublicKey({
    key: Buffer.from(base64Der, 'base64'),
    format: 'der',
    type: 'spki',
  })
}

/** Compact JWS: base64url(header).base64url(payload).base64url(signature) */
export function encode(header: JwsHeader, payload: unknown, privateKeyDer: string): string {
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  const signature = edSign(null, Buffer.from(signingInput, 'utf8'), privateKeyFrom(privateKeyDer))
  return `${signingInput}.${b64u(signature)}`
}

export interface DecodedJws {
  header: JwsHeader
  payload: Record<string, unknown>
}

/** Structural decode only. Never trust the result before verify() succeeds. */
export function decode(token: string): DecodedJws {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed JWS: expected three segments')

  return {
    header: JSON.parse(fromB64u(parts[0]).toString('utf8')) as JwsHeader,
    payload: JSON.parse(fromB64u(parts[1]).toString('utf8')) as Record<string, unknown>,
  }
}

export function verifySignature(token: string, publicKeyDer: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    return edVerify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
      publicKeyFrom(publicKeyDer),
      fromB64u(parts[2]),
    )
  } catch {
    return false
  }
}
