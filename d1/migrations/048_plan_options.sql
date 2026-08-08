-- Per-plan paid add-ons (breakfast, airport transfer, day pass, optional tours…).
-- Pricing modes cover the three ways hotels actually charge for extras:
--   per_room        flat per booking (airport transfer)
--   per_person      × total guests (optional tours)
--   per_adult_child adults and children priced separately (meals)
-- Prices are entered in the hotel's own currency; price_usd is the derived
-- cache, exactly like plans.price_local / plans.price_usd.
CREATE TABLE IF NOT EXISTS plan_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_ja TEXT DEFAULT '',
  description TEXT DEFAULT '',
  pricing_type TEXT NOT NULL DEFAULT 'per_room',
  price_local REAL NOT NULL DEFAULT 0,
  price_usd REAL NOT NULL DEFAULT 0,
  child_price_local REAL,
  child_price_usd REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_options_plan ON plan_options(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_options_hotel ON plan_options(hotel_id);

-- What the guest actually bought, priced at booking time so later edits to the
-- option never rewrite history.
CREATE TABLE IF NOT EXISTS booking_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  option_id INTEGER,
  name TEXT NOT NULL,
  pricing_type TEXT NOT NULL,
  currency TEXT,
  unit_price_local REAL,
  unit_price_usd REAL,
  child_unit_price_local REAL,
  child_unit_price_usd REAL,
  quantity INTEGER NOT NULL DEFAULT 1,
  child_quantity INTEGER NOT NULL DEFAULT 0,
  amount_local REAL,
  amount_usd REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_options_booking ON booking_options(booking_id);

ALTER TABLE bookings ADD COLUMN options_total_usd REAL DEFAULT 0;
