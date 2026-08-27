# Mandi

**Make an ordinary Razorpay merchant transactable by an AI buyer — end to end, and safely.**

[![ci](https://github.com/vaibhavkothari33/Mandi/actions/workflows/ci.yml/badge.svg)](https://github.com/vaibhavkothari33/Mandi/actions/workflows/ci.yml)
[![attacks refused](https://img.shields.io/badge/adversarial%20suite-8%2F8%20refused-2ea043)](#the-adversarial-suite)
[![Next.js](https://img.shields.io/badge/Next.js-16.3.3-000000)](https://nextjs.org)
[![Node](https://img.shields.io/badge/Node-22-5FA04E)](https://nodejs.org)
[![Razorpay](https://img.shields.io/badge/Razorpay-test%20mode%20only-0C2451)](https://razorpay.com/docs/payments/dashboard/test-live-modes/)

Razorpay AI Buildathon — **Track 01, AI Growth & Agentic Commerce**.

---

## The thesis

> **The LLM never holds spending authority. It proposes; a deterministic gate verifies a
> signed, scoped mandate and executes.**

Most agentic commerce demos build the *buyer* side: a chatbot that checks out. Mandi builds
the **merchant** side — the half of the brief that reads *"make a merchant transactable by an
AI buyer end to end"* — because that is where the money actually moves, and where the safety
properties have to live.

An AI agent can discover this shop, read its catalogue, build a cart, and get a price locked.
It cannot authorise a payment. That requires a mandate signed by a human, and twelve
deterministic checks between the request and the charge.

---

## Quickstart

Requires **Node 22+**. No database to install, no accounts, no API keys.

```bash
npm install
npm run seed
npm start
```

Then, in a second terminal:

```bash
npm run buyer      # an honest agent completes a purchase
npm run attacks    # a hostile agent tries eight ways to break in
```

Open <http://localhost:3000> for the audit dashboard.

### Everything you can run

| Command | What it does |
|---|---|
| `npm run seed` | Seeds the catalogue, a demo agent and a mandate signing key |
| `npm start` | Runs the merchant |
| `npm run buyer` | An honest buyer agent walks the full flow |
| `npm run attacks` | The adversarial suite — exits non-zero on any breach |
| `npm run smoke` | Protocol-level checks against a running merchant |
| `npm test` | 84 unit tests |
| `npm run approve` | The human wallet: list, approve, deny or revoke consent |
| `npm run mcp:demo` | Drives the MCP server, showing the agent blocked at consent |

---

## How a purchase works

```
  buyer agent  ──proposes──►  discovery → catalogue → session → quote
                                                         │
                                              human approves in their wallet
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │   GATE    │  12 deterministic checks
                                                   └───────────┘
                                                         │
                                                         ▼
                                              Razorpay test-mode payment
       └────────────── hash-chained, append-only audit log ──────────────┘
```

### The mandate chain

Consent is modelled on AP2's chain and on how UPI **Reserve Pay** actually behaves — one
authorisation, drawn down by successive purchases:

- **Intent mandate** — *"this agent may spend up to ₹1,000 here, on groceries, for an hour."*
- **Cart mandate** — *"I approve this exact cart, at this exact price, right now."*

Both are Ed25519-signed JWS. The merchant holds only the public key, published at
`/.well-known/jwks.json`.

### The twelve checks

Ordered cheapest-first, so a dead session is refused before any signature is verified. Every
check has its own refusal code, and the whole sequence is recorded whether it passes or fails.

| # | Check | Refuses when |
|---|---|---|
| 1 | `session_exists` | No such session |
| 2 | `session_payable` | Session is completed, cancelled or incomplete |
| 3 | `no_live_payment` | Something is already charged or in flight |
| 4 | `intent_mandate_valid` | Signature, expiry, registration or reuse |
| 5 | `cart_mandate_valid` | Same, for the cart mandate |
| 6 | `agent_matches_caller` | The mandate belongs to a different agent |
| 7 | `cart_bound_to_session` | The mandate was issued for another session |
| 8 | `quote_current` | The quote expired or was superseded |
| 9 | `cart_unchanged` | Items or quantities moved after approval |
| 10 | `price_unchanged` | The catalogue moved after approval |
| 11 | `amount_matches_total` | The approved amount is not the amount owed |
| 12 | `within_intent_scope` | Amount, category or use count outside the grant |

---

## The adversarial suite

Nobody adversarially tests their own hackathon project. `npm run attacks` runs a hostile buyer
agent against a live merchant and asserts every attempt is refused. It runs in CI on every
push.

| # | Attack | Refused by |
|---|---|---|
| 1 | Spend beyond the granted limit | `scope_amount_exceeded` |
| 2 | Replay a mandate that was already spent | `mandate_already_used` |
| 3 | Enlarge the cart after approval | `quote_superseded` |
| 4 | Use an expired mandate | `mandate_expired` |
| 5 | Reprice between approval and completion | `quote_price_drift` |
| 6 | Buy outside the authorised category | `scope_category` |
| 7 | Forge the approved amount | `amount_mismatch` |
| 8 | Race two completions at once | exactly one charge |

**Attack 5 is the interesting one.** The agent quotes, the human takes forty seconds to
approve, and the price moves in that window. The cart is byte-identical and `cart_unchanged`
passes — yet the purchase is refused, in *both* directions. A price cut is refused too:
consent was collected for one transaction, and executing a different one is not what the human
agreed to. The recovery path is tested as well — re-quote, re-approve, and the purchase
completes at the new price.

---

## Connecting to Claude

The repository ships `.mcp.json`, so Claude Code picks the server up automatically:

```bash
claude          # from the repo root, with `npm start` running in another terminal
```

Then ask it to shop:

> Search the catalogue for groceries, buy two packets of chai, and get my approval first.

Claude will search, open a checkout, lock a quote — and stop. It has no tool that can sign
consent. Approve in a second terminal:

```bash
npm run approve                          # lists what is waiting, and what is still live
npm run approve -- apr_xxxxxxxx          # sign the mandates
npm run approve -- --deny apr_xxxxxxxx   # refuse a pending request
npm run approve -- --revoke apr_xxxxxxxx # withdraw consent already granted
```

Consent that has been granted but not yet spent is live authority, so the listing shows it and
it can be withdrawn. Revocation consumes the underlying cart mandate rather than setting a
flag, so the gate refuses it by the same single-use rule that stops a replay — enforcement, not
a note the merchant has to remember to read.

Claude can then complete the purchase. `npm run mcp:demo` shows the same sequence
non-interactively, including the agent trying to spend an approval that is still pending.

### The six tools, and the one that is missing

`search_catalog` · `start_checkout` · `get_quote` · `request_approval` · `check_approval` ·
`complete_purchase`

There is no tool that signs a mandate. The agent can *ask* for consent and *spend* consent
that already exists; it cannot *create* it. Signing lives in `lib/wallet.ts`, reachable only
from the approval CLI, standing in for a wallet app on the buyer's own device.

---

## Razorpay test mode

Mandi runs without credentials — a stub executor stands in, so the repository stays
clone-and-run and the test suite never touches the network.

To use real test-mode calls:

1. Sign up at [razorpay.com](https://razorpay.com) — **no KYC needed for test keys**
2. Switch the dashboard to **Test** mode
3. **Account & Settings → API Keys → Generate Key**
4. Copy both values — **the secret is shown only once**
5. `cp .env.example .env` and paste them in, then restart

`lib/pay/index.ts` detects the keys and swaps the executor. Nothing else changes.

**The executor refuses to start on a live key.** Its constructor throws unless the key begins
`rzp_test_`, so a project like this cannot touch real money by accident.

---

## What is real, and what is modelled

Stated plainly, because a payments panel will ask.

| | Status |
|---|---|
| Checkout endpoints | **Shaped by** the ACP spec — the five session endpoints and its status model. Not a conformance claim |
| Mandate chain | **Inspired by** AP2 — signed JWS, not the full W3C Verifiable Credentials stack |
| UPI Reserve Pay | **Modelled**, not integrated. Drawdown behaves like a reserve; the NPCI rail is not available in test mode |
| Razorpay orders and payment links | **Real** test-mode API calls with real identifiers |
| Payment capture | **Not real.** Test mode has no payer, so no capture event can occur. `succeeded` means the provider accepted the instruction. The signed webhook route handles the capture transition for a live flow |
| Catalogue | Seeded, not a real merchant's inventory |
| Mandate private key | Held locally, because Mandi also plays the issuer for the demo. In production it belongs to the buyer's wallet — the merchant path only ever reads the public half |

---

## Layout

```
app/
  .well-known/            discovery manifest, JWKS
  api/                    catalogue, checkout sessions, quote, complete, cancel, webhook
  page.tsx                audit dashboard
  sessions/[id]/          the full trail for one purchase
  attacks/                adversarial scorecard
lib/
  gate.ts                 the twelve checks and the authorisation path
  mandate/                issue, verify, scope, keys, JWS
  session/                state machine and store
  quote.ts                price locking and drift detection
  pay/                    executor interface, Razorpay, stub
  wallet.ts               buyer-side signing — not reachable from the merchant API
  audit.ts                hash-chained append-only log
harness/
  client.ts               signed agent client, able to forge bad requests
  buyer.ts                an honest agent
  attacks.ts              a hostile one
mcp/server.ts             the six buyer tools
```

Design decisions and their rationale: [`ARCHITECTURE.md`](ARCHITECTURE.md).
What broke while building this, and how it was fixed: [`DEVLOG.md`](DEVLOG.md).
