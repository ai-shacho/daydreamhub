-- Alternative rescue: mark stuck processing jobs as failed.
-- Usage:
--   npx wrangler d1 execute daydreamhub-db --remote --file scripts/d1-mark-stuck-processing-failed.sql

BEGIN TRANSACTION;

SELECT COUNT(*) AS processing_count_before
FROM concierge_image_jobs
WHERE status = 'processing';

UPDATE concierge_image_jobs
SET
  status = 'failed',
  error = COALESCE(error || ' | ', '') || 'marked failed from stale processing at ' || datetime('now'),
  updated_at = datetime('now')
WHERE status = 'processing';

SELECT changes() AS rows_marked_failed;
SELECT status, COUNT(*) AS cnt
FROM concierge_image_jobs
GROUP BY status
ORDER BY status;

COMMIT;
