-- Add status column to hotels table
-- 'active': publicly visible (replaces is_active=1)
-- 'demo': URL-only preview page, hidden from all listings
-- 'inactive': not visible anywhere (replaces is_active=0)
ALTER TABLE hotels ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';

-- Migrate existing data
UPDATE hotels SET status = 'active' WHERE is_active = 1;
UPDATE hotels SET status = 'inactive' WHERE is_active = 0;
