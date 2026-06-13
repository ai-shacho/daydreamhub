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
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

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
CREATE INDEX IF NOT EXISTS idx_hotels_slug ON hotels(slug);
CREATE INDEX IF NOT EXISTS idx_hotels_city ON hotels(city);
CREATE INDEX IF NOT EXISTS idx_hotels_country ON hotels(country);
CREATE INDEX IF NOT EXISTS idx_hotels_is_active ON hotels(is_active);

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
CREATE INDEX IF NOT EXISTS idx_plans_hotel_id ON plans(hotel_id);
CREATE INDEX IF NOT EXISTS idx_plans_hotel_active ON plans(hotel_id, is_active);

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
CREATE INDEX IF NOT EXISTS idx_bookings_hotel_id ON bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_plan_id ON bookings(plan_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);

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
CREATE INDEX IF NOT EXISTS idx_reviews_hotel_id ON reviews(hotel_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking_id ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

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
CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON review_replies(review_id);

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
CREATE INDEX IF NOT EXISTS idx_hotel_amenities_hotel_id ON hotel_amenities(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_amenities_amenity_id ON hotel_amenities(amenity_id);

-- Hotel images
CREATE TABLE IF NOT EXISTS hotel_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hotel_images_hotel_id ON hotel_images(hotel_id);

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
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_hotel_id ON wishlist(hotel_id);

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
CREATE INDEX IF NOT EXISTS idx_hotel_staff_hotel_id ON hotel_staff(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_staff_user_id ON hotel_staff(user_id);

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
CREATE INDEX IF NOT EXISTS idx_call_logs_booking_id ON call_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_hotel_id ON call_logs(hotel_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_status ON call_logs(status);

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
CREATE INDEX IF NOT EXISTS idx_hotel_edit_requests_hotel_id ON hotel_edit_requests(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_edit_requests_status ON hotel_edit_requests(status);

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
CREATE INDEX IF NOT EXISTS idx_blocked_dates_hotel_id ON blocked_dates(hotel_id);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(blocked_date);

-- Admin login attempts
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email ON admin_login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip ON admin_login_attempts(ip);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_attempted_at ON admin_login_attempts(attempted_at);

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
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);

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
CREATE INDEX IF NOT EXISTS idx_messages_booking_id ON messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_hotel_id ON messages(hotel_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

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
CREATE INDEX IF NOT EXISTS idx_concierge_sessions_updated_at ON concierge_sessions(updated_at);

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
CREATE INDEX IF NOT EXISTS idx_concierge_messages_session_id ON concierge_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_messages_created_at ON concierge_messages(created_at);

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
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_session_id ON concierge_call_groups(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_status ON concierge_call_groups(status);
CREATE INDEX IF NOT EXISTS idx_concierge_call_groups_payment_status ON concierge_call_groups(payment_status);

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
CREATE INDEX IF NOT EXISTS idx_concierge_calls_session_id ON concierge_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_group_order ON concierge_calls(call_group_id, call_order);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_status ON concierge_calls(status);
CREATE INDEX IF NOT EXISTS idx_concierge_calls_telnyx_call_id ON concierge_calls(telnyx_call_id);

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
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_city ON blog_posts(city);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at);
