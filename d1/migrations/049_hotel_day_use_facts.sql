-- What the AI learned by phone about hotels we do not list.
--
-- "Does this place do day-use at all" is close to a permanent fact, while
-- "is it free right now" is not. Separating them lets a second guest asking
-- about the same hotel be answered without paying for another call, and lets
-- confirmed non-participants drop out of search results.
--
-- Keyed by digits-only phone number: the only stable identifier we hold for a
-- hotel that is not in our own hotels table.
CREATE TABLE IF NOT EXISTS hotel_day_use_facts (
  phone_key TEXT PRIMARY KEY,
  hotel_name TEXT,
  -- 'yes'  = confirmed to offer day-use (even if full on the asked date)
  -- 'no'   = explicitly said they do not do day-use
  day_use TEXT NOT NULL,
  last_price REAL,
  last_currency TEXT,
  verify_count INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_day_use_facts_state ON hotel_day_use_facts(day_use, last_verified_at);
