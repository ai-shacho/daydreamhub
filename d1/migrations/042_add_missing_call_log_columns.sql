-- Ensure call_logs has all columns referenced by call automation/webhooks.
-- Some environments were created before these fields existed.

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS scheduled_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS ended_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS transcription TEXT;

-- Keep known runtime-updated timestamp fields non-null when possible.
UPDATE call_logs
SET
  scheduled_at = COALESCE(scheduled_at, NULL),
  started_at = COALESCE(started_at, NULL),
  ended_at = COALESCE(ended_at, NULL),
  transcription = COALESCE(transcription, NULL)
WHERE 1 = 1;
