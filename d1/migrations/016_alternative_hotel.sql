-- Alternative Hotel on Decline feature
-- Tracks which hotels have been tried per booking

CREATE TABLE IF NOT EXISTS booking_hotel_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_id    INTEGER NOT NULL REFERENCES hotels(id),
  plan_id     INTEGER NOT NULL REFERENCES plans(id),
  outcome     TEXT NOT NULL DEFAULT 'pending',
  attempted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(booking_id, hotel_id)
);

CREATE INDEX IF NOT EXISTS idx_bha_booking ON booking_hotel_attempts(booking_id);

-- New columns on bookings for alternative hotel tracking
ALTER TABLE bookings ADD COLUMN original_hotel_id INTEGER;
ALTER TABLE bookings ADD COLUMN original_plan_id INTEGER;
ALTER TABLE bookings ADD COLUMN alt_round INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN alt_status TEXT;
ALTER TABLE bookings ADD COLUMN alt_choice_deadline TEXT;
ALTER TABLE bookings ADD COLUMN paypal_capture_id TEXT;
ALTER TABLE bookings ADD COLUMN refund_reason TEXT;
