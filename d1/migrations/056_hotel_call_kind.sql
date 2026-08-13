-- What kind of business a listing is, when a person has decided it by hand.
--
-- The automated booking-request call reads a fixed message to whoever answers.
-- That belongs at a hotel front desk and nowhere else, so each listing carries
-- a classification. Most come from checking each business against the web, held
-- in src/lib/data/hotelCallKind.ts. This column is the override: whatever is
-- here wins, because a person looked.
--
-- NULL means "no one has overridden it" — fall back to the checked value.
-- Values: hotel | apartment | spa_salon | private_host | not_real | unclear
--
-- Deliberately not reusing auto_call_enabled: that flag belongs to the
-- concierge feature, which calls hotels to book on a guest's behalf. Two
-- different calls, two different questions.
ALTER TABLE hotels ADD COLUMN call_kind TEXT DEFAULT NULL;

-- Who set it and when, so a surprising value can be traced rather than guessed at.
ALTER TABLE hotels ADD COLUMN call_kind_set_by TEXT DEFAULT NULL;
ALTER TABLE hotels ADD COLUMN call_kind_set_at TEXT DEFAULT NULL;
