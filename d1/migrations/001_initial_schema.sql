-- 001_initial_schema.sql
-- Restored baseline schema (equivalent to missing early migrations 001-015)
-- Safety policy: create-only + idempotent statements for existing production DBs.

PRAGMA foreign_keys = ON;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hotels (do NOT include columns that are added by later migrations: review_requested_at, coords_verified_at, status)
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ja TEXT,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  description_ja TEXT,
  city TEXT,
  country TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  thumbnail_url TEXT,
  images TEXT,
  property_type TEXT,
  email TEXT,
  phone TEXT,
  website_url TEXT,
  ical_url TEXT,
  amenities TEXT,
  categories TEXT,
  cancellation_policy TEXT,
  auto_call_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plans
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_ja TEXT,
  description TEXT,
  description_ja TEXT,
  price_usd REAL NOT NULL DEFAULT 0,
  check_in_time TEXT,
  check_out_time TEXT,
  plan_type TEXT,
  max_guests INTEGER,
  duration_hours INTEGER,
  cancellation_policy TEXT,
  cancellation_hours INTEGER,
  room_type TEXT,
  room_type_image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  plan_id INTEGER,
  user_id INTEGER,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  check_in_date TEXT,
  check_out_date TEXT,
  check_in_time TEXT,
  check_out_time TEXT,
  guests INTEGER NOT NULL DEFAULT 1,
  total_price REAL,
  special_requests TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
-- NOTE:
-- Existing production DBs may already have a legacy `bookings` table definition
-- without `user_id`. Because this baseline migration must be idempotent,
-- avoid creating a `user_id` index here (it would fail with
-- `no such column: user_id` when table creation is skipped by IF NOT EXISTS).

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  booking_id INTEGER,
  user_id INTEGER,
  guest_name TEXT,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Review replies
CREATE TABLE IF NOT EXISTS review_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  hotel_id INTEGER,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Amenities master
CREATE TABLE IF NOT EXISTS amenities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hotel ↔ amenities relation
CREATE TABLE IF NOT EXISTS hotel_amenities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  amenity_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hotel_id, amenity_id),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (amenity_id) REFERENCES amenities(id) ON DELETE CASCADE
);

-- Hotel images
CREATE TABLE IF NOT EXISTS hotel_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

-- Wishlist / favorites
CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  hotel_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, hotel_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);
-- NOTE:
-- Existing production DBs may already have a legacy `wishlist` table definition
-- without `user_id`. Keep this baseline migration idempotent by avoiding
-- a `user_id` index creation here.

-- Hotel staff mapping (do NOT include staff_role; added in migration 022)
CREATE TABLE IF NOT EXISTS hotel_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  invited_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hotel_id, user_id),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
);
-- NOTE:
-- Existing production DBs may already have a legacy `hotel_staff` table definition
-- without `user_id`. Keep this baseline migration idempotent by avoiding
-- a `user_id` index creation here.

-- Owner notification settings
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL UNIQUE,
  booking_email_enabled INTEGER NOT NULL DEFAULT 1,
  booking_sms_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

-- Booking call logs (do NOT include price_quoted; added in migration 021)
CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  hotel_id INTEGER,
  telnyx_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE SET NULL
);

-- Hotel edit requests
CREATE TABLE IF NOT EXISTS hotel_edit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  requested_by INTEGER,
  changes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Blocked dates / inventory lock
CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  blocked_date TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hotel_id, blocked_date),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

-- Admin login attempts
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- News / What's New
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

-- Email/message logs
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

-- Exchange-rate cache
CREATE TABLE IF NOT EXISTS exchange_rate_cache (
  base TEXT PRIMARY KEY,
  rates TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Concierge chat sessions
CREATE TABLE IF NOT EXISTS concierge_sessions (
  id TEXT PRIMARY KEY,
  locale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Concierge message history
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

-- Concierge grouped phone-booking requests
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

-- Concierge individual call attempts
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

-- Blog posts (base columns only; automation columns are added by later migration 029)
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
