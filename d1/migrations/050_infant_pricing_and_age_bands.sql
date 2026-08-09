-- Add-ons priced by age group need a third rate: the booking form already asks
-- for infants, so an option that charges per adult and child had no way to say
-- what an infant costs (or that it is free).
ALTER TABLE plan_options ADD COLUMN infant_price_local REAL;
ALTER TABLE plan_options ADD COLUMN infant_price_usd REAL;

-- What counts as a child or an infant is the hotel's own policy, so the guest
-- can see the bands before choosing. NULL means the hotel hasn't stated one.
ALTER TABLE hotels ADD COLUMN infant_max_age INTEGER;
ALTER TABLE hotels ADD COLUMN child_max_age INTEGER;

-- Record how many infants an add-on was charged for, alongside adults/children.
ALTER TABLE booking_options ADD COLUMN infant_unit_price_local REAL;
ALTER TABLE booking_options ADD COLUMN infant_unit_price_usd REAL;
ALTER TABLE booking_options ADD COLUMN infant_quantity INTEGER NOT NULL DEFAULT 0;
