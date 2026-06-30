-- Twilio call logging detail expansion
-- 1) Extend call_logs for richer per-call summary fields
-- 2) Add call_log_events for per-webhook/event timeline

ALTER TABLE call_logs ADD COLUMN provider TEXT;
ALTER TABLE call_logs ADD COLUMN phase TEXT;
ALTER TABLE call_logs ADD COLUMN from_number TEXT;
ALTER TABLE call_logs ADD COLUMN to_number TEXT;
ALTER TABLE call_logs ADD COLUMN last_step TEXT;
ALTER TABLE call_logs ADD COLUMN last_event_type TEXT;
ALTER TABLE call_logs ADD COLUMN last_call_status TEXT;
ALTER TABLE call_logs ADD COLUMN answered_at TEXT;
ALTER TABLE call_logs ADD COLUMN ended_at TEXT;
ALTER TABLE call_logs ADD COLUMN duration_seconds INTEGER;
ALTER TABLE call_logs ADD COLUMN metadata_json TEXT;

CREATE TABLE IF NOT EXISTS call_log_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'twilio',
  event_type TEXT NOT NULL,
  phase TEXT,
  step TEXT,
  turn INTEGER,
  call_sid TEXT,
  call_status TEXT,
  digits TEXT,
  speech_result TEXT,
  note TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (call_log_id) REFERENCES call_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_call_log_events_call_log_id ON call_log_events(call_log_id);
CREATE INDEX IF NOT EXISTS idx_call_log_events_created_at ON call_log_events(created_at);
CREATE INDEX IF NOT EXISTS idx_call_log_events_event_type ON call_log_events(event_type);

CREATE INDEX IF NOT EXISTS idx_call_logs_provider_created_at ON call_logs(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_call_logs_to_number ON call_logs(to_number);
