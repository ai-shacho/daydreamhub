-- Outreach Twilio v2 status tracking columns

ALTER TABLE outreach_leads ADD COLUMN person_in_charge_name TEXT DEFAULT '';
ALTER TABLE outreach_leads ADD COLUMN last_outreach_status TEXT DEFAULT '';

ALTER TABLE outreach_call_attempts ADD COLUMN person_in_charge_name TEXT DEFAULT '';
ALTER TABLE outreach_call_attempts ADD COLUMN recognized_status TEXT DEFAULT '';
ALTER TABLE outreach_call_attempts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_outreach_leads_last_status ON outreach_leads(last_outreach_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_attempts_status ON outreach_call_attempts(recognized_status, created_at DESC);
