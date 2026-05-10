CREATE TABLE IF NOT EXISTS outreach_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT DEFAULT '',
  email TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  call_log_id INTEGER,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
