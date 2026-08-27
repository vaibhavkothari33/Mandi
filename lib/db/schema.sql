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
  version           INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS mandates (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('intent','cart')),
  subject     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  scope_json  TEXT NOT NULL,
  cart_hash   TEXT,
  jws         TEXT NOT NULL,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT
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
