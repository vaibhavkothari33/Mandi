# Development log

What broke, why, and how it was resolved.

## 2026-08-27

**`node:sqlite` types missing at build.**
`next build` failed with `TS2307: Cannot find module 'node:sqlite'`. The scaffold pinned
`@types/node@^20`; `node:sqlite` landed in Node 22. Runtime was fine, only typings were stale.
Upgraded to `@types/node@^22` to match the runtime.

**Scripts could not resolve `@/` path aliases.**
`node scripts/seed.ts` failed with `ERR_MODULE_NOT_FOUND`. The `@/*` alias is a bundler
convention that bare Node does not read. Switched `lib/` and `scripts/` to relative imports,
leaving `@/` only in `app/` where Next resolves it.

**Node ESM rejected extensionless imports.**
Relative imports still failed: Node's ESM resolver requires explicit file extensions. Added
`.ts` specifiers plus `allowImportingTsExtensions` in tsconfig, so the same modules load under
both the Next bundler and bare `node`. This keeps the attack harness runnable outside Next.

**`.env.example` silently untracked.**
The scaffold's `.gitignore` contains `.env*`, which swallows the example file. Added an
`!.env.example` negation.

**Hydration mismatch on `<body>`.**
React reported mismatched `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` attributes.
Both are injected by the Grammarly browser extension before React hydrates. Added
`suppressHydrationWarning` to `<body>`; it is shallow, so genuine mismatches inside the tree
still surface.

## 2026-08-28

**Node type-stripping rejected TypeScript parameter properties.**
`ApiError` used `constructor(readonly status: number, ...)`. Node failed with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`: strip-only mode deletes type syntax but cannot emit the
field assignments a parameter property implies. Rewrote with explicit fields. Same constraint
rules out enums and namespaces, so the codebase avoids both.

**A stale dev server served a build that predated the checkout routes.**
Every `POST /api/checkout_sessions` returned the 404 page even though `next build` listed the
route. Cause: an earlier server was still bound to port 3000. `pkill -f "next start"` had not
matched it, because on Windows the running process is `node`, not `next`. The same stale
process was holding the old SQLite file open, which had also blocked deleting it earlier.
Now released by port rather than by name via `Get-NetTCPConnection -LocalPort 3000`.

**Test teardown failed with EBUSY on Windows.**
Removing the temp directory threw `EBUSY: resource busy or locked` because the SQLite handle
was still open. Windows will not unlink an open file. Added `close()` to the database client
and call it before cleanup.

**`node --test tests/` treated `helpers.ts` as a test file.**
A shared helper module with no tests failed the run. Narrowed the glob to `tests/*.test.ts`.

**Verification switched from curl to a fetch script.**
Shell pipelines of `curl | node -e` broke on Windows path handling (`/tmp` resolved to `D:\tmp`)
and made empty-variable bugs surface as confusing 308 redirects. Replaced with
`scripts/smoke.ts` using `fetch`, which is cross-platform and reusable as the basis for the
buyer harness.

## 2026-08-29

**Top-level `await` rejected in a script with no imports.**
`next build` failed with `TS1375: 'await' expressions are only allowed at the top level of a
file when that file is a module`. `scripts/smoke.ts` used `fetch` and had no imports, so
TypeScript treated it as a global script rather than a module. Resolved naturally when the
script began importing the signed client; the alternative was an empty `export {}`.

**Idempotency needed a claim-before-work insert, not a check-then-write.**
An initial read-then-insert left a window where two concurrent requests with the same key both
saw "no existing record" and both proceeded. The insert itself is now the lock: the row is
written with a null response before any work happens, so the second caller finds a claim in
flight and is refused.

## 2026-08-30

**A scope test asserted the wrong boundary.**
`a cart is measured against remaining authority` failed expecting `ok` and receiving
`scope_amount_exceeded`. The test was wrong, not the code: with ₹800 already drawn against a
₹1,000 intent, remaining authority is ₹200, so the default ₹250 cart is correctly refused.
Rewrote the case around the exact boundary (₹200 passes, ₹200.01 does not) and added the
inverse assertion, so the test now demonstrates drawdown rather than accidentally passing.

**Mandate verification order had to be fixed deliberately.**
An early draft read `payload.kind` and `payload.aud` before checking the signature, which
means branching on attacker-controlled data. Reordered so nothing in the payload is consulted
until the signature verifies, with only structural decoding ahead of it.

## 2026-08-31

**The audit log recorded `allow` for refused completions.**
Reading the trail for a real purchase showed `session.complete allow` on a request that had
returned HTTP 409. The gate reports refusals as return values rather than exceptions, and the
mutation pipeline inferred success from the absence of a throw. An audit trail that mislabels
a refusal is worse than none, so the record now follows the response status and carries the
refusal code. Found by reading the output, not by a failing test.

**Two gate tests asserted checks that path cannot reach.**
`mandate_already_used` and `payment_already_exists` were expected after a completed purchase,
but both return `session_not_payable`: the gate evaluates cheap session checks before any
signature verification. The behaviour was right and the tests were wrong. Rewrote them to
reach those codes honestly, and added an assertion that a dead session stops after two checks
so the early-exit ordering is itself covered.

**Parameter properties resurfaced in a test helper.**
A `FixedExecutor` class used `constructor(private readonly result)` and hit the same
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` as `ApiError` on day 3. Replaced with a factory returning
an object literal.

## 2026-09-01

**Type stripping let a breaking signature change through the test suite.**
Adding `quote_id` to cart mandates made two older test fixtures structurally invalid, but all
77 tests still passed: Node strips types without checking them, so a missing required property
is invisible at runtime. Only `next build` caught it. The test command proves behaviour and the
build proves types; neither alone is sufficient, and both now run before every commit.

**Cart tampering became unreachable over HTTP, in a good way.**
The smoke test asserted `cart_hash_mismatch` when an agent enlarges an approved cart, and began
failing with `quote_superseded`. Mutating a session invalidates its quote, so the quote check
now refuses first. Both barriers are real and independent; the assertion was updated to match
the actual order, and the hash check is still exercised directly in the gate tests.

**Razorpay test mode cannot produce a capture.**
Test mode has no payer, so no `payment.captured` event can occur without a human paying a link.
The executor creates a real order and a real UPI payment link and reports success on that
basis, and the signed webhook route handles the capture transition for a live flow. Recorded
here and in the README rather than presented as a completed charge.

## 2026-09-02

**MCP tool calls are not serialised, and a naive probe raced itself.**
A first test piped several `tools/call` requests into the server at once and read the replies
in arrival order. `request_approval` answered before `get_quote`, so approval was requested
against a session that had no quote yet and the probe reported a failure that did not exist.
The server was correct: JSON-RPC ids exist precisely because responses may arrive out of
order. Replaced the probe with `scripts/mcp-demo.ts`, which correlates replies by id and
awaits each call the way a real client does.

**Deciding where consent could not live.**
An earlier sketch gave the MCP server a tool that signed a cart mandate. That is convenient
and wrong: it would let the agent manufacture its own authorisation, which is the exact
property the gate exists to prevent. Mandate signing moved to `lib/wallet.ts`, reachable only
from the approval CLI. The agent's tool list now has no way to create consent, only to
request it and to spend one a human already granted.

## 2026-09-03

**Ageing a mandate by editing the database did nothing.**
The expiry attack first set `expires_at` on the stored mandate row to the past and expected a
refusal. The gate accepted it: expiry is read from the signed `exp` claim inside the JWS, not
from the bookkeeping column beside it. That is the correct precedence — a merchant that
trusted its own mutable column over the signature could be talked into honouring a mandate the
buyer never granted — so the attack was rewritten to present a genuinely short-lived mandate.
The database columns exist for querying, not for deciding.

**The race attack needed a different success condition.**
Attacks 1 to 7 assert a specific refusal code. Attack 8 fires two completions at once, where
either request may legitimately win, so asserting a code is meaningless. Its condition is a
count instead: exactly one HTTP 200 and exactly one live payment row. The loser's code is
recorded but not asserted, because which barrier catches it depends on scheduling.

## 2026-09-04

**The first real Razorpay call failed, and exposed a misclassification.**
With test-mode keys in place the buyer completed the gate and then reported
`payment_indeterminate`. Razorpay's message was exact: *"UPI Payment Links is not supported in
Test Mode."* Two separate faults sat behind that one line.

The first was the request: `upi_link: true` is a live-mode capability. Dropped it; a standard
payment link works in test mode.

The second was worse, and was ours. Any non-OK response from the link call was being reported
as `unknown`, which holds the mandate and freezes the session for human reconciliation. But a
definitive 4xx means the link was never created, so nothing can be charged against it — that is
`failed`, and safe to release. Only a 5xx or a transport fault leaves the outcome genuinely
unknown. The two are now distinguished at the response, not at the call site.

**The indeterminate path discarded the provider's order id.**
`settle()` was called on success and on failure but not on `unknown`, so the one outcome that
exists to be reconciled by a human stored `razorpay_order_id: null`. The held payment now
persists whatever identifiers came back before freezing, and the audit entry carries them too.

**Real latency changed which barrier caught the race.**
Attack 8 previously reported `session_not_payable`; against the live API it reports
`payment_already_exists`. Both are correct — slower calls shift which check the losing request
reaches first. The assertion is a count (one HTTP 200, one live payment), not a code, so the
test was unaffected. Asserting the code there would have produced a flake that only appeared
once real credentials were configured.

## 2026-09-04 (later)

**A real session found consent that could not be withdrawn.**
Driving the MCP server from Claude, the agent built a cart, the human changed their mind, and
the agent rebuilt it as a second session. The human then approved the *first* approval by
mistake and asked to cancel it. There was no way to.

The agent declined to spend the stale approval, which is the right outcome — but it reached
that outcome by judgement, not because anything stopped it. The gate would have allowed it: the
mandate was validly signed, in scope, bound to its own session, and its quote was still live.
Relying on the model to decline is exactly the property this project argues against.

Added `wallet.revoke()`. It consumes the underlying cart mandate rather than setting a flag, so
a withdrawn approval is refused by the same single-use rule that stops a replay — the gate did
not need a new check. A test asserts this by clearing `revoked_at` back to null and confirming
the gate still refuses: the approval row is a display, the mandate is the control.

The CLI listing now also shows approvals that are granted but unspent, since that is live
authority the human could not previously see. Adding a column to a table created by
`CREATE TABLE IF NOT EXISTS` needed a guarded `ALTER TABLE` at open, so existing databases
migrate instead of silently lacking the field.

## 2026-09-05

**The remote MCP endpoint returned an empty stream.**
Adding `/api/mcp` for web clients, `initialize` answered `200 text/event-stream` with no body.
The handler closed the server in a `finally` block immediately after `handleRequest` returned —
but that Response streams its body, so the server was being torn down before anything was
written to it. Moved the teardown onto `transport.onclose`, so the server outlives the response
it is still writing. The auth check failed correctly throughout, which is why this looked like
an auth problem first.

## 2026-09-06

**Adding a browser checkout risked creating a second way to spend money.**
A human buying directly does not need a mandate — they are present, and the click is the
consent. But a "Pay" button that skips the gate would have left twelve checks on the agent path
and none beside it, which is the opposite of the argument this project makes.

Resolved by having the browser path sign its own mandate at the moment of the click and then run
the same `authorize()` as the agent path. There is exactly one way to spend money here, and a
human order produces the same twelve checks in the same audit trail. A test asserts the check
count and that the trail shape matches.

**The public pay route was an obvious way around consent.**
An unauthenticated endpoint that completes a checkout is one an agent could call on its own
session to self-approve. Three things close it, none of which needed a new auth system: browser
sessions are stamped with the reserved identity `human:web`; that identity is never registered
in the agents table, so `registerAgent` refuses it and HMAC authentication for it always fails;
and the pay route refuses any session not stamped that way. Creation also returns a claim token,
so one browser cannot complete another's checkout.

**A checkout now belongs to the buyer who opened it.**
While testing the above, an agent could still request approval against a *browser* cart — not a
breach, since a human would still have to approve it, but two buyers reaching into one checkout
is confusing and unnecessary. The gate's `agent_matches_caller` check now also compares the
mandate against the session's owner, refusing with `mandate_wrong_buyer`.

## 2026-09-06 (later)

**The merchant dashboard failed to render, and the cause was the database driver.**
`/merchant` returned 500 with *"Only plain objects, and a few built-ins, can be passed to Client
Components"*. `node:sqlite` returns rows with a **null prototype**, and React refuses to
serialise those across the server/client boundary.

The confusing part was that `/api/merchant/stats` returned the same data correctly the whole
time — `JSON.stringify` does not care about prototypes, only the prop boundary does. Rows that
leave the stats function are now copied into plain objects, and a test asserts it by checking
`Object.getPrototypeOf` on everything that crosses the boundary, so this cannot regress quietly.
