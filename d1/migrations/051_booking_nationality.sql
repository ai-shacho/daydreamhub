-- Hotels routinely need the guest's nationality: local registration rules,
-- language for the welcome, and which ID to expect at check-in. It was only
-- ever reachable by asking the guest after the fact.
ALTER TABLE bookings ADD COLUMN guest_nationality TEXT;
