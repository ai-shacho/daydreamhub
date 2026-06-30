-- Add updated_at column to call_logs for explicit update tracking
ALTER TABLE call_logs ADD COLUMN updated_at TEXT;

-- Backfill existing rows to avoid NULLs for historical data
UPDATE call_logs
SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
WHERE updated_at IS NULL;
