-- Ensure call_logs has all columns referenced by call automation/webhooks.
-- Some environments were created before these fields existed.

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS scheduled_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS ended_at TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS transcription TEXT;
