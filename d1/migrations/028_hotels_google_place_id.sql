-- Add google_place_id column to hotels table (idempotent for re-runs)
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS google_place_id TEXT;
