-- Outreach Phase 2: timezone windowing, recall policy controls, and A/B script foundation

-- Lead-level scheduling/timezone metadata
ALTER TABLE outreach_leads ADD COLUMN timezone TEXT DEFAULT '';
ALTER TABLE outreach_leads ADD COLUMN timezone_source TEXT DEFAULT ''; -- csv / country_guess / manual / unknown
ALTER TABLE outreach_leads ADD COLUMN next_callable_at TEXT; -- UTC datetime, null means callable now
ALTER TABLE outreach_leads ADD COLUMN cycle_completed_at TEXT; -- when first-pass (uncalled) cycle completed for this lead/list context
ALTER TABLE outreach_leads ADD COLUMN assigned_script_variant TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_outreach_leads_status_next_callable
  ON outreach_leads(status, next_callable_at, updated_at);

-- Attempt metadata for analytics/A-B comparison
ALTER TABLE outreach_call_attempts ADD COLUMN script_variant TEXT DEFAULT '';
ALTER TABLE outreach_call_attempts ADD COLUMN script_prompt_version TEXT DEFAULT 'v1';

CREATE INDEX IF NOT EXISTS idx_outreach_attempts_variant_created
  ON outreach_call_attempts(script_variant, created_at DESC);

-- A/B variants master table
CREATE TABLE IF NOT EXISTS outreach_script_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,               -- e.g. A / B / C
  name TEXT NOT NULL,
  opening_line TEXT NOT NULL,
  followup_line TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed default variants (idempotent)
INSERT OR IGNORE INTO outreach_script_variants (code, name, opening_line, followup_line, active)
VALUES
  ('A', 'Control', 'Hello! This is Sarah calling from DayDreamHub, a day-use hotel booking platform. We connect travelers with hotels that offer short daytime stays, and listing is completely free. If you would like our materials, press 1. If you would like a follow-up explanation call, press 2. You can also answer by voice.', 'Thank you. To help us route correctly, press 1 for materials or press 2 for a follow-up explanation call.', 1),
  ('B', 'Value-first', 'Hi, this is Sarah from DayDreamHub. We help hotels get incremental daytime bookings at no listing cost. If you want our intro materials, press 1. If you prefer a short explanation call from our team, press 2. You can also answer by voice.', 'Great, thanks. Press 1 for materials, or press 2 for a follow-up explanation call.', 1);
