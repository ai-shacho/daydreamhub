-- Backfill missing base tables for existing DBs where 001 was already applied
-- This migration is intentionally idempotent and ordered before 029_*.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_ja TEXT,
  content TEXT,
  content_ja TEXT,
  category TEXT NOT NULL DEFAULT 'update',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  hotel_id INTEGER,
  direction TEXT,
  recipient_email TEXT,
  sender_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,
  error_detail TEXT,
  message_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_booking_id ON messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_hotel_id ON messages(hotel_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE TABLE IF NOT EXISTS exchange_rate_cache (
  base TEXT PRIMARY KEY,
  rates TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concierge_sessions (
  id TEXT PRIMARY KEY,
  locale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_concierge_sessions_updated_at ON concierge_sessions(updated_at);

CREATE TABLE IF NOT EXISTS concierge_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  message_type TEXT,
  image_key TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES concierge_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_concierge_messages_session_id ON concierge_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_messages_created_at ON concierge_messages(created_at);

CREATE TABLE IF NOT EXISTS concierge_call_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_order INTEGER NOT NULL DEFAULT 0,
  total_calls INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'required',
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  refund_status TEXT,
  refund_id TEXT,
  request_details TEXT,
  guest_name TEXT,
  guest_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES concierge_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_session_id ON concierge_call_groups(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_status ON concierge_call_groups(status);
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_payment_status ON concierge_call_groups(payment_status);

CREATE TABLE IF NOT EXISTS concierge_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  call_group_id INTEGER,
  call_order INTEGER NOT NULL DEFAULT 1,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  hotel_name TEXT,
  hotel_phone TEXT,
  hotel_source TEXT,
  hotel_id INTEGER,
  request_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  outcome TEXT,
  payment_status TEXT NOT NULL DEFAULT 'none',
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  refund_status TEXT,
  refund_id TEXT,
  recommendation_reason TEXT,
  telnyx_call_id TEXT,
  ai_summary TEXT,
  availability_info TEXT,
  price_quoted TEXT,
  guest_name TEXT,
  guest_email TEXT,
  confirmation_email_sent INTEGER NOT NULL DEFAULT 0,
  confirmation_fax_sent INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES concierge_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (call_group_id) REFERENCES concierge_call_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_session_id ON concierge_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_group_order ON concierge_calls(call_group_id, call_order);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_status ON concierge_calls(status);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_telnyx_call_id ON concierge_calls(telnyx_call_id);

CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_ja TEXT,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  city TEXT,
  thumbnail_url TEXT,
  content TEXT,
  content_ja TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_city ON blog_posts(city);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at);
