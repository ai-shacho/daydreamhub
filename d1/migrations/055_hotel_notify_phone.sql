-- A second number for a listing: the person who actually answers.
--
-- hotels.phone is the property's main line, which on a front desk at 2am is
-- nobody. The old signup form asked separately for "the contact person's direct
-- number" and 127 hotels gave one; this is where those land, so a booking
-- notification can try the person before the switchboard.
ALTER TABLE hotels ADD COLUMN notify_phone TEXT DEFAULT NULL;
