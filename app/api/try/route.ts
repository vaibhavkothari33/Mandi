import { ATTACKS, resetCatalog } from '@/harness/attacks'
import { AgentClient } from '@/harness/client'
import { ApiError, errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Attacks a visitor can run against the live gate.
 *
 * Only the ones that need no prior completed purchase are offered: the others
 * would consume Razorpay's test-mode payment-link allowance, which is capped
 * per account and would run out under any real traffic.
 */
const OFFERED = [1, 3, 5, 6, 7]

/** One attack at a time per visitor, and a global ceiling so this cannot be used to hammer the gate. */
const recent = new Map<string, number>()
const COOLDOWN_MS = 1500
let inFlight = 0
const MAX_IN_FLIGHT = 4

/**
 * The attack runner calls this same app several times. When development is
 * exposed through a tunnel, sending those calls back through the public URL
 * makes the test depend on the tunnel recursively. Use loopback in dev; a
 * deployed multi-instance app can explicitly supply its private origin.
 */
function internalBase(request: Request): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL
  if (process.env.NODE_ENV !== 'production') return `http://127.0.0.1:${process.env.PORT ?? 3000}`
  return new URL(request.url).origin
}

function throttle(request: Request): void {
  const who =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'local'

  const last = recent.get(who) ?? 0
  const now = Date.now()

  if (now - last < COOLDOWN_MS) {
    throw new ApiError(429, 'too_fast', 'give the previous attempt a moment to finish')
  }

  if (inFlight >= MAX_IN_FLIGHT) {
    throw new ApiError(429, 'busy', 'too many attempts running at once; try again shortly')
  }

  recent.set(who, now)
  if (recent.size > 500) recent.clear()
}

export async function GET() {
  return Response.json({
    attacks: ATTACKS.filter((a) => OFFERED.includes(a.id)).map((a) => ({
      id: a.id,
      name: a.name,
      premise: a.premise,
      expected: a.expected,
    })),
  })
}

export async function POST(request: Request) {
  try {
    throttle(request)

    const body = (await request.json().catch(() => ({}))) as { attack?: number }
    const attack = ATTACKS.find((a) => a.id === body.attack && OFFERED.includes(a.id))
    if (!attack) throw new ApiError(400, 'unknown_attack', 'no such attack is offered')

    inFlight += 1
    try {
      const result = await attack.run(new AgentClient({ base: internalBase(request) }))

      return Response.json({
        id: attack.id,
        name: attack.name,
        premise: attack.premise,
        expected: attack.expected,
        refused: result.refused && !result.setupFailed,
        code: result.code,
        detail: result.detail,
      })
    } finally {
      inFlight -= 1
      // Attack 5 moves a catalogue price; put it back whatever happened.
      resetCatalog()
    }
  } catch (err) {
    // Preserve the safe client response while leaving the actual failure in
    // the server log for diagnosis.
    console.error('Try-it attack failed', err)
    return errorResponse(err)
  }
}
