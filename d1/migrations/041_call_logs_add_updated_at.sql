-- call_logs.updated_at already exists in the base schema (001).
-- Keep this migration as a safe backfill/no-op to preserve migration order.
UPDATE call_logs
SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
WHERE updated_at IS NULL;
