-- Outreach dedupe + list management for CSV imports
-- Requirement: avoid duplicate leads when re-uploading the same list
-- Dedupe key policy:
--   1) hard unique by normalized phone (when present)
--   2) hard unique by normalized (hotel_name + phone)
--   3) API-level reuse check by (phone OR hotel_name) to avoid near-duplicates

-- 1) Extend outreach_leads with normalized columns used for dedupe/UPSERT
ALTER TABLE outreach_leads ADD COLUMN phone_norm TEXT DEFAULT '';
ALTER TABLE outreach_leads ADD COLUMN hotel_name_norm TEXT DEFAULT '';
ALTER TABLE outreach_leads ADD COLUMN first_list_id INTEGER;
ALTER TABLE outreach_leads ADD COLUMN last_list_id INTEGER;

-- Backfill normalized values for existing rows
UPDATE outreach_leads
SET
  phone_norm = lower(replace(replace(replace(replace(replace(replace(trim(COALESCE(phone, '')), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')),
  hotel_name_norm = lower(trim(COALESCE(hotel_name, '')))
WHERE COALESCE(phone_norm, '') = '' OR COALESCE(hotel_name_norm, '') = '';

-- 2) List container for each upload operation
CREATE TABLE IF NOT EXISTS outreach_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'csv', -- csv / manual / api
  file_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',   -- active / duplicate_only / archived / deleted
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  created_by TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3) Join table: which leads belong to which list
CREATE TABLE IF NOT EXISTS outreach_list_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  source_row_no INTEGER,
  duplicate_reason TEXT DEFAULT '', -- phone_match / hotel_match / exact_match / in_file_duplicate
  status TEXT NOT NULL DEFAULT 'active', -- active / duplicate / removed
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(list_id, lead_id),
  FOREIGN KEY (list_id) REFERENCES outreach_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES outreach_leads(id) ON DELETE CASCADE
);

-- 4) Unique constraints / indexes for dedupe
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_leads_phone_norm
  ON outreach_leads(phone_norm)
  WHERE phone_norm IS NOT NULL AND phone_norm <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_leads_hotel_phone_norm
  ON outreach_leads(hotel_name_norm, phone_norm)
  WHERE hotel_name_norm IS NOT NULL AND hotel_name_norm <> ''
    AND phone_norm IS NOT NULL AND phone_norm <> '';

CREATE INDEX IF NOT EXISTS idx_outreach_leads_hotel_name_norm ON outreach_leads(hotel_name_norm);
CREATE INDEX IF NOT EXISTS idx_outreach_lists_status_created_at ON outreach_lists(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_list_members_list_id ON outreach_list_members(list_id);
CREATE INDEX IF NOT EXISTS idx_outreach_list_members_lead_id ON outreach_list_members(lead_id);
