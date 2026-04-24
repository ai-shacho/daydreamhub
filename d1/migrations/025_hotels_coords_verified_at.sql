-- Add coords_verified_at column to hotels table for Map Check "mark as verified" feature.
-- When admin confirms DB coordinates are correct (even if Google disagrees — e.g. head office
-- address returned for chain hotels), set this timestamp. Map Check excludes verified hotels
-- from mismatch/location_mismatch results until coordinates are changed again.
ALTER TABLE hotels ADD COLUMN coords_verified_at INTEGER;
