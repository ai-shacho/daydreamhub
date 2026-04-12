-- Add price_quoted column to call_logs for storing hotel's quoted price during AI calls
ALTER TABLE call_logs ADD COLUMN price_quoted REAL DEFAULT NULL;
