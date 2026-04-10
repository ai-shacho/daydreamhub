-- Add staff_role column to hotel_staff table
-- Values: 'co_owner' (same permissions as owner) or 'booking_manager' (limited)
ALTER TABLE hotel_staff ADD COLUMN staff_role TEXT DEFAULT 'booking_manager';
