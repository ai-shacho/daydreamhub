-- Track invalid CSV rows separately from duplicate rows in outreach imports
ALTER TABLE outreach_lists ADD COLUMN invalid_rows INTEGER NOT NULL DEFAULT 0;
