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
npm run dev
```

Then, in a second terminal:

```bash
npm run buyer      # an honest agent completes a purchase
npm run attacks    # a hostile agent tries eight ways to break in
```

Open <http://localhost:3000>. Three views worth a look:

| Page | What it shows |
|---|---|
| `/` | The landing page — five attacks a visitor can run against the live gate themselves |
| `/shop` | The storefront, buying as a person |
| `/merchant` | The shopkeeper's side — revenue, and how much of it came from agents |
| `/orders` | Every order and what state it reached |
| `/sessions/[id]` | Every decision behind one order, human or agent |
| `/approve/[id]` | The consent page a human lands on from their inbox |
| `/pay/[id]` | Merchant-hosted Razorpay checkout for an authorised order |

### Everything you can run

| Command | What it does |
|---|---|
| `npm run seed` | Seeds the catalogue, a demo agent and a mandate signing key |
| `npm run dev` | Runs the merchant |
| `npm run build && npm start` | The production build, if you want it |
| `npm run buyer` | An honest buyer agent walks the full flow |
| `npm run attacks` | The adversarial suite — exits non-zero on any breach |
| `npm run smoke` | Protocol-level checks against a running merchant |
| `npm test` | 109 unit tests |
| `npm run approve` | The human wallet: list, approve, deny or revoke consent |
| `npm run mcp:demo` | Drives the MCP server, showing the agent blocked at consent |
| `npm run webhook:test` | Signs a Razorpay event and drives the capture path — proves it without the dashboard |
| `npm run verify-audit` | Walks the whole audit log and re-checks the hash chain |
| `npm run links` | Lists or cancels Razorpay payment links, for the test-mode quota |

---

## How a purchase works

```
  buyer agent  ──proposes──►  discovery → catalogue → session → quote
                                                         │
                                       human consents on their own device
                                    (emailed link, or the wallet CLI) — signs
                                          the intent and cart mandates
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │   GATE    │  12 deterministic checks
                                                   └───────────┘
                                                         │  authorises — does not settle
                                                         ▼
                                              Razorpay test-mode payment
                                                         │
                                            signed payment.captured webhook
                                                         │  the only thing that
                                                         ▼  completes a sale
                                                     completed
       └───────── hash-chained, Ed25519-signed, append-only audit log ─────────┘
```

### The five session states

```
not_ready_for_payment ──► ready_for_payment ──► pending_payment ──► completed
         ▲                        │                    │
         └────────────────────────┘                    │ declined
            cart or address edited                     ▼
                                                ready_for_payment
```

`pending_payment` is the window between authorising a charge and knowing it landed: the mandate
is spent, the provider holds the instruction, and nobody yet knows whether money moved. The
session enters it *before* the provider is called, so a process that dies mid-flight leaves a
session that reads as in-flight rather than as payable.

`completed` has exactly one predecessor, and the machine is enforced in `update()` rather than
merely documented — there is no path that declares a sale without first declaring that an
instruction went out.

### How consent reaches a human

The agent asks. The merchant emails the person who can actually say yes:

```
agent calls request_approval
        │
        ▼
  email lands on the buyer's phone — who is asking, the exact cart, the exact total
        │
        ▼
  one press: "Approve & pay ₹562.90"   →  /approve/[id]
        │
        ├── price still live  ──► signs both mandates ──► GATE ──► Razorpay checkout
        └── price moved       ──► signs nothing, shows the new total, asks again
```

The link goes to the buyer's device, never to the agent — the agent has no tool that can
reach it. Rendering the page signs nothing; every mandate is minted behind the POST, so a
mail client prefetching the URL cannot spend anything.

That single press collapses two steps a human would otherwise do minutes apart — approving in
a wallet, then paying — without weakening what the merchant checks. The mandates are still
signed buyer-side, the same twelve checks still run, and the sale still completes only on a
signature-verified capture webhook.

**A quote that expired in the inbox is relocked, not honoured.** If the relock changes what is
owed, nothing is signed: the new total comes back for the human to confirm explicitly. Consent
is only ever given against a live price.

Two emails per purchase, never three — the approval request, then the receipt. A buyer who is
standing at the checkout does not also get told the order is waiting to be paid.

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
claude          # from the repo root, with `npm run dev` running in another terminal
```

Then ask it to shop:

> Search the catalogue for groceries, buy two packets of chai, and get my approval first.

Claude will search, open a checkout, lock a quote — and stop. It has no tool that can sign
consent.

If `RESEND_API_KEY` is set, the approval request is already on your phone: open it, press
**Approve & pay**, and the checkout opens on your own device. Otherwise — or when you would
rather see the wallet directly — approve from a second terminal:

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

### Claude on the web

Claude.ai reaches connectors from Anthropic's infrastructure, not from your machine, so a
stdio server is unreachable there. The same six tools are also served over HTTP at `/api/mcp`
for that case.

The endpoint can create payment instructions, so it fails closed. Claude.ai custom connectors
use OAuth: configure the two OAuth secrets below, then use the full `/api/mcp` URL in Claude.
When Claude opens the approval page, enter `MCP_OAUTH_APPROVAL_TOKEN`. The access token Claude
receives is valid for one hour. `MCP_BEARER_TOKEN` remains available for clients that can send a
pre-shared `Authorization: Bearer` header, such as the MCP Inspector.

```bash
# 1. set two long random secrets in .env, then restart
MCP_OAUTH_APPROVAL_TOKEN=$(openssl rand -hex 32)
MCP_OAUTH_SIGNING_SECRET=$(openssl rand -hex 32)
MCP_PUBLIC_BASE_URL=https://your-public-tunnel.example

# 2. expose it over HTTPS — Claude cannot reach localhost
ngrok http --url your-reserved-domain.ngrok-free.dev 3000
```

Use a *reserved* domain. With an ephemeral tunnel the URL changes on every restart, and both
the Claude connector and the Razorpay webhook have to be re-registered each time —
`MCP_PUBLIC_BASE_URL` and `PUBLIC_BASE_URL` must match it exactly, or discovery hands Claude a
dead host.

Add the printed `https://…/api/mcp` URL as a custom connector in Claude's settings, with the
approval token during the browser authorization page. Do not add a Client ID or secret in
Claude: it dynamically registers with this server. Treat the tunnel as public: anyone holding
the URL and approval token can drive the buyer tools, so keep this on test-mode keys.

### The webhook is not optional against real Razorpay keys

Creating a Razorpay order is an instruction, not a capture — nobody has paid yet. So with real
test-mode keys the gate answers `202` and parks the session at `pending_payment`; only a signed
`payment.captured` webhook completes it and sends the receipt. Set `RAZORPAY_WEBHOOK_SECRET` to
the endpoint secret from the Razorpay dashboard and point the endpoint at
`https://…/api/webhooks/razorpay`. Without it that route returns `503` and sessions stay pending
by design.

With no Razorpay keys the stub executor runs, observes its own capture, and completes inline —
which is why the test suite and `npm run smoke` need no network.

You do not need the dashboard to prove any of this. `npm run webhook:test` signs a body with
the endpoint secret exactly as Razorpay would and posts it at a running server. It refuses a
forged signature *first* — a `200` on a signed body says nothing about whether the check works
unless an unsigned one was rejected — then settles, replays the same event to show redelivery
is idempotent, and asserts the session moved.

### When a payment fails

A declined card is not an error path bolted on afterwards; it is a state the machine already
has a name for.

Razorpay posts `payment.failed`. The route verifies the signature, marks the payment failed,
**releases the cart mandate**, and walks the session back to `ready_for_payment` — payable
again, by the same consent, without asking the human to approve a second time. The refusal is
recorded in the audit log as a refusal, not as a gap.

The buyer then retries in the same modal and the card succeeds. That sequence — *failed, then
captured, on one order* — is worth calling out, because handling it wrongly is a way to take
someone's money and never ship their goods:

```bash
npm run webhook:test -- --failed order_XXXX   # decline
npm run webhook:test -- order_XXXX            # the retry that succeeds
```

The capture now lands on a session sitting at `ready_for_payment`, not `pending_payment`. An
earlier version of this route completed sales only from `pending_payment`, so the retry left
five real orders paid for and never fulfilled, with no receipt sent. The route now settles
from either state, re-consumes the mandate the failure released, and still refuses to invent a
transition: a sale is always completed *through* `pending_payment`, because money moving is
never allowed to skip the state that says an instruction went out.

### Optional email

Mandi sends three kinds of mail, of which any one purchase sees at most two:

| Mail | When |
|---|---|
| **Approval request** | An agent asked to spend. Carries the `Approve & pay` link — this is the one that holds authority |
| **Payment due** | An order was authorised but the buyer was not at the checkout. Suppressed when they are |
| **Receipt** | The capture webhook settled the sale |

Set `RESEND_API_KEY` and, if needed, `RESEND_FROM` (a Resend-verified sender) in `.env`.
Leaving them unset keeps checkout working normally and sends no email — a missing or invalid
key never blocks a purchase. Each send is keyed with an idempotency key derived from the
approval or session, so a retried request never mails twice.

Mail goes to a single demo recipient; set `RECEIPT_TO_EMAIL` and `RECEIPT_TO_NAME` to point it
at yourself.

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
| Razorpay orders | **Real** test-mode API calls with real `order_…` identifiers |
| Razorpay payment links | **Off by default.** Test mode caps them at thirty per account, which a demo exhausts quickly, so payment happens on the merchant's own hosted checkout instead. Set `RAZORPAY_PAYMENT_LINKS=1` to re-enable them |
| Payment capture | **Real, and webhook-driven.** A test-mode card really is charged on the hosted checkout, and Razorpay really does post back `payment.captured`. Accepting an order is only an instruction, so the gate answers `202` and parks the session at `pending_payment`; nothing but a signature-verified capture event completes it |
| Payment failure | **Real.** A declined card posts `payment.failed`, which releases the cart mandate and returns the session to `ready_for_payment` so the buyer can retry |
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
  approve/[id]/           the emailed consent page — signs mandates behind the POST
  pay/[id]/               merchant-hosted Razorpay checkout
lib/
  gate.ts                 the twelve checks and the authorisation path
  consent.ts              approve-and-pay: one press, mandates signed, gate run
  mandate/                issue, verify, scope, keys, JWS
  session/                state machine and store
  quote.ts                price locking and drift detection
  pay/                    executor interface, Razorpay, stub
  wallet.ts               buyer-side signing — not reachable from the merchant API
  receipt.ts              approval request, payment due, receipt
  audit.ts                hash-chained, Ed25519-signed append-only log
harness/
  client.ts               signed agent client, able to forge bad requests
  buyer.ts                an honest agent
  attacks.ts              a hostile one
mcp/server.ts             the six buyer tools
```

Design decisions and their rationale: [`ARCHITECTURE.md`](ARCHITECTURE.md).
What broke while building this, and how it was fixed: [`DEVLOG.md`](DEVLOG.md).
