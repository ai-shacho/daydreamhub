-- Which reminder stages have already gone out for a booking.
-- One row per (booking, stage), so a cron run that overlaps a previous one — or
-- a retry after a partial failure — cannot email the same owner twice.
CREATE TABLE IF NOT EXISTS booking_owner_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,          -- hours elapsed: 6, 12 or 24
  sent_at TEXT DEFAULT (datetime('now')),
  UNIQUE (booking_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_booking_owner_reminders_booking ON booking_owner_reminders(booking_id);
