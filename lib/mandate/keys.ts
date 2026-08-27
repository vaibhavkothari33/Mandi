import { generateKeyPairSync } from 'node:crypto'
import { db, nowIso } from '../db/client.ts'
import { sha256 } from '../canonical.ts'

export interface Keypair {
  kid: string
  publicKey: string
  privateKey: string | null
}

const kidFor = (publicKeyDer: string): string => `key_${sha256(publicKeyDer).slice(0, 16)}`

function generate(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ed25519')
  return {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  }
}

/**
 * In production the mandate private key belongs to the buyer's wallet, not the
 * merchant. It is held here because Mandi also plays the issuer for the demo;
 * the merchant path only ever reads the public half.
 */
export function ensureKeypair(): Keypair {
  const existing = db()
    .prepare('SELECT * FROM mandate_keys ORDER BY created_at LIMIT 1')
    .get() as { kid: string; public_key: string; private_key: string | null } | undefined

  if (existing) {
    return { kid: existing.kid, publicKey: existing.public_key, privateKey: existing.private_key }
  }

  const envPublic = process.env.MANDATE_PUBLIC_KEY
  const envPrivate = process.env.MANDATE_PRIVATE_KEY
  const pair = envPublic && envPrivate ? { publicKey: envPublic, privateKey: envPrivate } : generate()
  const kid = kidFor(pair.publicKey)

  db()
    .prepare('INSERT INTO mandate_keys (kid, public_key, private_key, created_at) VALUES (?, ?, ?, ?)')
    .run(kid, pair.publicKey, pair.privateKey, nowIso())

  return { kid, publicKey: pair.publicKey, privateKey: pair.privateKey }
}

export function publicKeyFor(kid: string): string | null {
  const row = db().prepare('SELECT public_key FROM mandate_keys WHERE kid = ?').get(kid) as
    | { public_key: string }
    | undefined
  return row?.public_key ?? null
}

/** OKP/Ed25519 JWK. The raw key is the last 32 bytes of the SPKI encoding. */
export function jwks(): { keys: Array<Record<string, string>> } {
  const rows = db().prepare('SELECT kid, public_key FROM mandate_keys').all() as Array<{
    kid: string
    public_key: string
  }>

  return {
    keys: rows.map((row) => ({
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: row.kid,
      x: Buffer.from(row.public_key, 'base64').subarray(-32).toString('base64url'),
    })),
  }
}
