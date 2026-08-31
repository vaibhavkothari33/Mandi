-- All monetary values are integer paise.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  category     TEXT    NOT NULL,
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
  currency     TEXT    NOT NULL DEFAULT 'INR',
  stock        INTEGER NOT NULL CHECK (stock >= 0),
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  secret     TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                TEXT PRIMARY KEY,
  status            TEXT    NOT NULL,
  agent_id          TEXT,
  intent_mandate_id TEXT REFERENCES mandates(id),
  items_json        TEXT    NOT NULL DEFAULT '[]',
  fulfillment_json  TEXT,
  totals_json       TEXT,
  quote_id          TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  version           INTEGER NOT NULL DEFAULT 0,
  claim_token_hash  TEXT
);

CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT    NOT NULL REFERENCES checkout_sessions(id),
  cart_hash    TEXT    NOT NULL,
  total_paise  INTEGER NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'INR',
  issued_at    TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS mandate_keys (
  kid         TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  private_key TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mandates (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('intent','cart')),
  subject      TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  intent_id    TEXT REFERENCES mandates(id),
  session_id   TEXT,
  scope_json   TEXT NOT NULL,
  cart_hash    TEXT,
  amount_paise INTEGER,
  jws          TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT
);

CREATE INDEX IF NOT EXISTS mandates_by_intent ON mandates(intent_id);

-- A buyer-side approval request. The agent may create one; only a human may
-- decide it. Nothing here is reachable from the merchant API.
CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  session_id   TEXT    NOT NULL REFERENCES checkout_sessions(id),
  quote_id     TEXT    NOT NULL,
  agent_id     TEXT    NOT NULL,
  subject      TEXT    NOT NULL,
  amount_paise INTEGER NOT NULL,
  summary      TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending','approved','denied')),
  intent_jws   TEXT,
  cart_jws     TEXT,
  created_at   TEXT    NOT NULL,
  decided_at   TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  endpoint        TEXT    NOT NULL,
  request_hash    TEXT    NOT NULL,
  response_status INTEGER,
  response_json   TEXT,
  created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT    NOT NULL REFERENCES checkout_sessions(id),
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  amount_paise        INTEGER NOT NULL,
  currency            TEXT    NOT NULL DEFAULT 'INR',
  status              TEXT    NOT NULL,
  created_at          TEXT    NOT NULL
);

-- Database-level guarantee that a session cannot be charged twice.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_per_session
  ON payments(session_id) WHERE status != 'failed';

CREATE TABLE IF NOT EXISTS audit_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('allow','refuse','info')),
  reason      TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  prev_hash   TEXT,
  hash        TEXT NOT NULL,
  at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_by_session ON audit_log(session_id, seq);

CREATE TABLE IF NOT EXISTS attack_results (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  premise       TEXT    NOT NULL,
  expected      TEXT    NOT NULL,
  actual        TEXT    NOT NULL,
  refused       INTEGER NOT NULL,
  detail        TEXT    NOT NULL DEFAULT '',
  ran_at        TEXT    NOT NULL
);

-- Dynamic OAuth client registrations for the remote MCP connector.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
