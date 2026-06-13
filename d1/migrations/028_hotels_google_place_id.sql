-- Add google_place_id column to hotels table
-- NOTE: SQLite (D1) does not support `IF NOT EXISTS` for ADD COLUMN.
ALTER TABLE hotels ADD COLUMN google_place_id TEXT;
