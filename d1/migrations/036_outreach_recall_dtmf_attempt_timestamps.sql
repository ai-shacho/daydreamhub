-- Outreach enhancements: recall flag, DTMF interest capture, and per-attempt call timestamps (JST/local)

ALTER TABLE outreach_leads ADD COLUMN needs_recall INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach_leads ADD COLUMN requested_materials INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach_leads ADD COLUMN requested_explanation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach_leads ADD COLUMN do_not_call INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS outreach_call_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  call_log_id INTEGER,
  telnyx_call_id TEXT,
  outcome TEXT DEFAULT '', -- interested / not_interested / no_answer / voicemail / failed / in_progress
  raw_hangup_reason TEXT DEFAULT '',
  call_started_at_utc TEXT DEFAULT (datetime('now')),
  call_started_at_jst TEXT DEFAULT '',
  call_started_weekday_jst INTEGER,
  call_started_hour_jst INTEGER,
  lead_timezone TEXT DEFAULT '',
  call_started_at_local TEXT DEFAULT '',
  call_started_weekday_local INTEGER,
  call_started_hour_local INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES outreach_leads(id) ON DELETE CASCADE,
  FOREIGN KEY (call_log_id) REFERENCES call_logs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outreach_call_attempts_lead_id_created_at
  ON outreach_call_attempts(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_call_attempts_call_log_id
  ON outreach_call_attempts(call_log_id);
