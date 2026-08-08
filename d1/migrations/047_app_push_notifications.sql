-- Web Push for the /app PWA.
-- Payload-less push is used, so only the endpoint is strictly needed; the
-- session id ties a device to the inquiries it made.
CREATE TABLE IF NOT EXISTS app_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  lang TEXT DEFAULT 'en',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_push_session ON app_push_subscriptions(session_id);

-- Small key/value store; holds the VAPID keypair so no new deploy secret is
-- needed (the private key never leaves the server).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Marks a quoted call as already pushed, so a device is notified once.
ALTER TABLE concierge_calls ADD COLUMN app_push_sent INTEGER NOT NULL DEFAULT 0;
