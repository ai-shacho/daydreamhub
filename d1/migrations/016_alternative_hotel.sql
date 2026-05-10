-- Alternative Hotel on Decline feature
-- Already applied manually to production DB. This is a no-op to mark it as applied.

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

-- ALTER TABLE statements omitted: columns already exist in production DB
-- original_hotel_id, original_plan_id, alt_round, alt_status,
-- alt_choice_deadline, paypal_capture_id, refund_reason
