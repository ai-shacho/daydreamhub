-- Store Google Place ID for hotels.
-- Enables precise coordinate lookup via Place Details API on subsequent Map Check runs,
-- avoiding name-matching ambiguity that occurs with text geocoding.
ALTER TABLE hotels ADD COLUMN google_place_id TEXT;
