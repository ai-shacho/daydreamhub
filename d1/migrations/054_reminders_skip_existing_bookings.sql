-- Reminders start from bookings made after this feature ships, not before.
--
-- Every booking that is already waiting on its owner is recorded as if all
-- three reminders had already been sent, so the first cron run cannot chase a
-- request that has been sitting there for weeks.
--
-- To turn reminders on for a specific hotel's existing bookings later, delete
-- its rows and the normal schedule takes over from the booking's created_at:
--   DELETE FROM booking_owner_reminders
--    WHERE booking_id IN (SELECT id FROM bookings WHERE hotel_id = ? AND status IN ('pending','pending_confirmation'));
INSERT OR IGNORE INTO booking_owner_reminders (booking_id, stage)
SELECT b.id, s.stage
  FROM bookings b
  JOIN (SELECT 6 AS stage UNION ALL SELECT 12 UNION ALL SELECT 24) s
 WHERE b.status IN ('pending', 'pending_confirmation');
