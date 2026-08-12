-- Second hotel email: the person-in-charge (担当者) address. hotels.email stays
-- the booking-management (予約管理) address. Booking-related notifications are
-- sent to BOTH, deduplicated.
ALTER TABLE hotels ADD COLUMN contact_email TEXT DEFAULT NULL;
