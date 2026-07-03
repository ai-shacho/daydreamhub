-- Ensure call_logs has all columns referenced by call automation/webhooks.
-- Some environments were created before these fields existed.

ALTER TABLE call_logs ADD COLUMN scheduled_at TEXT;
ALTER TABLE call_logs ADD COLUMN started_at TEXT;
ALTER TABLE call_logs ADD COLUMN ended_at TEXT;
ALTER TABLE call_logs ADD COLUMN transcription TEXT;
