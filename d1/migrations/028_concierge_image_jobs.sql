-- Track async flight-image analysis jobs
CREATE TABLE IF NOT EXISTS concierge_image_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  image_key TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | completed | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  analysis_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_concierge_image_jobs_session ON concierge_image_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_image_jobs_status ON concierge_image_jobs(status, created_at);
