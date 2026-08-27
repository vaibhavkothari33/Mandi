# Architecture

How Mandi is put together, and why each load-bearing decision was made that way.

---

## 1. The problem

An AI agent buying on someone's behalf creates a gap that ordinary checkout does not have.
In a normal purchase the party who consents and the party who acts are the same person. With
an agent they are different, separated in time, and the agent is a language model whose output
cannot be treated as authoritative.

So the design question is not "how does an agent check out". It is: **what must be true before
a merchant is willing to charge someone who is not present?**

Mandi answers that with one rule, and builds everything around it:

> The LLM never holds spending authority. It proposes; a deterministic gate verifies a signed,
> scoped mandate and executes.

Every component below exists either to establish that a mandate is genuine, or to prove the
transaction still matches what the mandate approved.

---

## 2. Trust boundaries

Three parties, with sharply different privileges.

```
   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
   │  BUYER AGENT │        │    WALLET    │        │   MERCHANT   │
   │   (Claude)   │        │  (the human) │        │   (Mandi)    │
   ├──────────────┤        ├──────────────┤        ├──────────────┤
   │ browse       │        │ sign intent  │        │ price        │
   │ build a cart │        │ sign cart    │        │ verify       │
   │ ask consent  │        │ deny         │        │ charge       │
   │ spend consent│        │              │        │ audit        │
   │              │        │              │        │              │
   │ CANNOT sign  │        │ holds the    │        │ holds only   │
   │ CANNOT price │        │ private key  │        │ the public   │
   └──────────────┘        └──────────────┘        └──────────────┘
```

Two properties are enforced structurally rather than by policy:

**The agent cannot price.** `resolveItems()` in `lib/session/store.ts` discards any
`unit_price_paise` the caller sends and reads the catalogue instead. A buyer agent chooses
*what* to buy; it does not get to assert *what it costs*. Without this, every downstream
mandate check is theatre — an agent could approve a cart it had priced itself.

**The agent cannot consent.** Mandate signing lives in `lib/wallet.ts`, which the merchant API
never imports and which the MCP server exposes no tool for. The six tools an agent has can
request an approval and spend one that exists. Creating one requires `npm run approve`.

Asymmetric keys make the third boundary real: the wallet signs with Ed25519, the merchant
verifies with the public half published at `/.well-known/jwks.json`. A compromised merchant
cannot forge consent it was never given.

---

## 3. Request pipeline

Every mutating request goes through one path — `handleMutation` in `lib/route.ts`. Security
that is opt-in per route eventually gets forgotten on one route.

```
raw body ─► authenticate ─► claim idempotency ─► run ─► record ─► audit ─► respond
              │                  │                        │         │
              │                  │                        │         └─ decision follows
              │                  │                        │            the response status
              │                  │                        └─ 4xx recorded, 5xx released
              │                  └─ the INSERT is the lock
              └─ HMAC over timestamp . METHOD . path . sha256(body)
```

**Request signing** binds four things: timestamp, verb, path and body digest. All four are in
the signature deliberately — otherwise a captured signature for "cancel session X" could be
replayed against "complete session X". Comparison is `timingSafeEqual`; `===` returns early on
the first differing byte, which leaks how much of a guess was right.

**Timestamps expire** at ±300 seconds, so a signature stolen yesterday is worthless today.

**Idempotency claims the key before doing any work.** An earlier version read, decided, then
inserted, which left a window where two concurrent requests both saw "no record" and both
proceeded. The `INSERT` is now the lock:

| Situation | Result |
|---|---|
| Same key, same body, response stored | Replays the stored response |
| Same key, same body, still running | `409 request_in_progress` |
| Same key, **different** body | `422 idempotency_key_reuse` |

Deterministic refusals (4xx) are recorded so a replay returns the same answer. Server faults
(5xx) release the key, so a transient blip does not permanently burn it.

---

## 4. The gate

`lib/gate.ts`. Twelve checks, ordered cheapest-first, each with a distinct refusal code. The
full sequence is returned whether it passes or fails, so the audit trail records what was
*evaluated*, not merely the verdict.

Ordering is a security property, not an optimisation: a completed session stops after two
checks, so no signature verification runs on a dead session.

Three checks defend the same attack from different angles, and this redundancy is deliberate:

- `cart_bound_to_session` — the mandate was issued for *this* checkout
- `cart_unchanged` — the items and quantities are the ones approved
- `price_unchanged` — the catalogue has not moved underneath them

Over HTTP, changing a cart trips `quote_current` first, because mutating a session invalidates
its quote. `cart_unchanged` sits behind that as an independent barrier and is exercised
directly in the unit tests. Two barriers, either sufficient.

### Price drift

`price_unchanged` is the check most systems omit. The agent quotes, the human takes forty
seconds to approve, and stock sells out or a price moves. The cart is byte-identical, so a hash
comparison passes.

Mandi refuses in **both** directions, including a price *cut*. Consent was collected for one
transaction; executing a different one is not what was agreed, and a merchant that silently
improves the deal has still substituted its own judgement for the buyer's. Refusal alone would
make the system unusable, so the recovery path is a tested first-class flow: re-quote,
re-approve, complete at the new price.

### Drawdown

An intent mandate behaves like a UPI Reserve Pay limit — one consent, drawn down by successive
purchases. `drawdown()` sums consumed cart mandates against the intent, so authority is
*remaining*, not original. The same cart, with the same signature, is allowed against a fresh
₹1,000 intent and refused once ₹800 is spent.

---

## 5. Handling money

**Integer paise, everywhere.** `0.1 + 0.2 !== 0.3`, and a rounding error in a payment system
is a real rupee belonging to a real person. Rupees exist only inside `formatInr()`, at the
display edge. GST is rounded once at order level rather than per line, so totals reconcile.

**Consume before paying, not after.** If the process dies mid-flight, a burnt mandate costs the
buyer one re-consent. The reverse ordering risks charging them twice. Recoverable beats
unrecoverable.

**`failed` and `unknown` are different outcomes.** Most implementations collapse them into
"didn't work". Collapsing them is how you double-charge someone.

| Outcome | Mandate | Session | Reasoning |
|---|---|---|---|
| `succeeded` | consumed | completed | — |
| `failed` — a definitive decline | **released** | payable again | Certain no money moved, so retry is safe |
| `unknown` — a timeout | **held** | frozen | Money *may* have moved. Releasing here is the double-charge |

An indeterminate payment blocks every further attempt until a human reconciles it.

**The database is the last line of defence.** A partial unique index —
`ON payments(session_id) WHERE status != 'failed'` — permits at most one live payment per
session. If every check above it were bypassed, the second charge still fails at storage.

---

## 6. The audit log

Append-only is a claim unless it can be checked. Each entry hashes the previous entry's hash,
so the log is a chain:

```
entry.hash = sha256(canonical({ prevHash, session, actor, action, decision, reason, detail, at }))
```

`verifyChain()` replays it and names the first row that fails. Flip a `refuse` to an `allow`
directly in the database and it is caught; delete a row and the chain breaks at the *next* one.
Both are tested in `tests/audit.test.ts`.

Canonical JSON — keys sorted at every depth — makes the hash reproducible regardless of key
insertion order.

One bug worth recording: the log originally wrote `allow` for refused completions. The gate
reports refusals as return values rather than exceptions, and the pipeline inferred success
from the absence of a throw. An audit trail that mislabels a refusal is worse than none. It now
follows the response status. **This was found by reading the output, not by a failing test.**

---

## 7. Storage

SQLite via Node 22's built-in `node:sqlite`. No dependency, no server, no account.

The reasoning is about the submission rather than the software: the differentiator here is an
attack suite that *proves* the gate refuses eight attacks, and an unrunnable proof is only a
claim. `npm install && npm run seed && npm run attacks` works on any machine with Node 22.
A hosted database would mean a connection string, which is either a leaked credential in a
public repository or a project nobody can run.

The tradeoff, stated: SQLite cannot run on Vercel, whose filesystem is read-only. If a live URL
were needed, the fix is a different *host* — Fly, Railway, Render with a volume — not a
different database. No code would change.

---

## 8. What would change in production

| Now | Production |
|---|---|
| Mandate private key in the merchant's database | Buyer's wallet or device; merchant holds only the public key |
| Approval via a local CLI | A wallet app with device biometrics |
| Reserve Pay modelled in application code | NPCI UAP / UPI Reserve Pay rails |
| One shared secret per agent | Rotating credentials, per-agent revocation |
| SQLite | Postgres with the same schema and constraints |
| Capture asserted at instruction time | Capture driven only by the signed webhook |

The parts that would not change are the parts that matter: the gate, the mandate chain, the
audit log, and the rule that no model output participates in a money decision.
