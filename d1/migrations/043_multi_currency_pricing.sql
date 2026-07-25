-- Multi-currency pricing: hotels set prices in their local currency,
-- guests see local + USD, PayPal settles in USD.
-- Existing data is backfilled as USD so behavior is unchanged until
-- an owner switches their hotel currency.

ALTER TABLE hotels ADD COLUMN currency TEXT;
ALTER TABLE plans ADD COLUMN price_local REAL;
ALTER TABLE bookings ADD COLUMN local_currency TEXT;
ALTER TABLE bookings ADD COLUMN local_amount REAL;
ALTER TABLE bookings ADD COLUMN fx_rate REAL;

UPDATE hotels SET currency = 'USD' WHERE currency IS NULL;
UPDATE plans SET price_local = price_usd WHERE price_local IS NULL;
