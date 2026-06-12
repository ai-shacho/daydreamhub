-- Reset stuck concierge image jobs so Queue consumer can retry them.
-- Usage:
--   npx wrangler d1 execute daydreamhub-db --remote --file scripts/d1-reset-stuck-processing.sql

BEGIN TRANSACTION;

-- 1) Preview current stuck rows
SELECT COUNT(*) AS processing_count_before
FROM concierge_image_jobs
WHERE status = 'processing';

-- 2) Reset all currently stuck processing jobs to queued for retry
UPDATE concierge_image_jobs
SET
  status = 'queued',
  error = COALESCE(error || ' | ', '') || 'reset from stale processing at ' || datetime('now'),
  updated_at = datetime('now')
WHERE status = 'processing';

-- 3) Verify result
SELECT changes() AS rows_reset_to_queued;
SELECT status, COUNT(*) AS cnt
FROM concierge_image_jobs
GROUP BY status
ORDER BY status;

COMMIT;
