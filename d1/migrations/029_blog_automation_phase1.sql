-- Phase 1: Blog Automation Foundation Migration
-- Adds columns for hybrid theme system, angles, automation status, and indexes

-- Safety backfill: some existing DBs may not have blog_posts yet.
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

ALTER TABLE blog_posts ADD COLUMN auto_generated INTEGER DEFAULT 0;
ALTER TABLE blog_posts ADD COLUMN favorite_theme TEXT;
ALTER TABLE blog_posts ADD COLUMN selected_angle TEXT;
ALTER TABLE blog_posts ADD COLUMN generation_status TEXT DEFAULT 'manual';
ALTER TABLE blog_posts ADD COLUMN last_generated_at TEXT;
ALTER TABLE blog_posts ADD COLUMN theme_source TEXT DEFAULT 'ai'; -- 'ai' | 'manual'
ALTER TABLE blog_posts ADD COLUMN generation_prompt TEXT;
ALTER TABLE blog_posts ADD COLUMN angle_rotation_index INTEGER DEFAULT 0;

-- Indexes for efficient automation queries
CREATE INDEX IF NOT EXISTS idx_blog_posts_auto_generated ON blog_posts(auto_generated);
CREATE INDEX IF NOT EXISTS idx_blog_posts_generation_status ON blog_posts(generation_status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_city_published ON blog_posts(city, published_at);
CREATE INDEX IF NOT EXISTS idx_blog_posts_favorite_theme ON blog_posts(favorite_theme);

-- Optional: Add table for theme preferences / admin settings if needed later
-- CREATE TABLE IF NOT EXISTS blog_settings (
--   id INTEGER PRIMARY KEY AUTOINCREMENT,
--   favorite_theme TEXT,
--   angle_list TEXT,
--   updated_at TEXT DEFAULT CURRENT_TIMESTAMP
-- );
