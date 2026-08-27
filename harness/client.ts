import { randomUUID } from 'node:crypto'
import { sign, signingPayload } from '../lib/signing.ts'

export interface Reply {
  status: number
  headers: Headers
  json: any
}

export interface CallOptions {
  /** Reuse a key to exercise idempotent replay. */
  idempotencyKey?: string
  /** Override the signed body to forge a mismatch. */
  signedBodyOverride?: string
  /** Skew the signed timestamp, in seconds. */
  timestampOffset?: number
  /** Sign with the wrong secret. */
  secretOverride?: string
  /** Drop specific headers. */
  omit?: string[]
}

export class AgentClient {
  readonly base: string
  readonly agentId: string
  private readonly secret: string

  constructor(opts: { base?: string; agentId?: string; secret?: string } = {}) {
    this.base = opts.base ?? process.env.BASE_URL ?? 'http://localhost:3000'
    this.agentId = opts.agentId ?? 'agent_demo_buyer'
    this.secret =
      opts.secret ?? process.env.DEMO_AGENT_SECRET ?? 'demo_secret_do_not_use_in_production'
  }

  async get(path: string): Promise<Reply> {
    const res = await fetch(`${this.base}${path}`, { headers: { 'Agent-Id': this.agentId } })
    return this.read(res)
  }

  async post(path: string, body: unknown, options: CallOptions = {}): Promise<Reply> {
    const raw = body === undefined ? '' : JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000) + (options.timestampOffset ?? 0))

    const payload = signingPayload({
      timestamp,
      method: 'POST',
      path,
      body: options.signedBodyOverride ?? raw,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Agent-Id': this.agentId,
      Timestamp: timestamp,
      Signature: sign(options.secretOverride ?? this.secret, payload),
      'Idempotency-Key': options.idempotencyKey ?? randomUUID(),
      'Request-Id': randomUUID(),
    }

    for (const name of options.omit ?? []) delete headers[name]

    const res = await fetch(`${this.base}${path}`, { method: 'POST', headers, body: raw })
    return this.read(res)
  }

  private async read(res: Response): Promise<Reply> {
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    return { status: res.status, headers: res.headers, json }
  }
}

export const ADDRESS = {
  name: 'A Buyer',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  postal_code: '560025',
  country: 'IN',
}
