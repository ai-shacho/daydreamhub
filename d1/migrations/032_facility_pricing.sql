-- Task #45: 施設タイプ別 料金・プラン管理システム
-- Safe to run multiple times (IF NOT EXISTS / column existence checks not possible in D1,
-- so ALTER TABLE statements are guarded by the migration runner's one-time execution)

-- ① 施設ごとの料金ルール（課金単位・時間丸め・年齢ルールJSON等）
CREATE TABLE IF NOT EXISTS facility_pricing_configs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id          INTEGER NOT NULL,
  billing_unit      TEXT    NOT NULL DEFAULT 'per_stay', -- 'per_hour' | 'per_day' | 'per_stay'
  min_hours         INTEGER NOT NULL DEFAULT 1,
  max_hours         INTEGER,                              -- NULL = unlimited
  time_rounding     TEXT    NOT NULL DEFAULT 'round_up', -- 'round_up' | 'round_down' | 'nearest'
  adult_price_usd   REAL,                                -- NULL = use plan base price
  age_rules         TEXT,                                -- JSON: {"child_rate":0.5,"child_age_max":12,"infant_rate":0.0,"infant_age_max":3}
  currency          TEXT    NOT NULL DEFAULT 'USD',
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

CREATE INDEX IF NOT EXISTS idx_fpc_hotel_id ON facility_pricing_configs(hotel_id);

-- ② 施設プラン（従量 metered / 固定 fixed）
CREATE TABLE IF NOT EXISTS facility_plans (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id            INTEGER NOT NULL,
  pricing_config_id   INTEGER,                    -- NULL = no special config, use base plan price
  name                TEXT    NOT NULL,
  name_ja             TEXT,
  description         TEXT,
  description_ja      TEXT,
  plan_type           TEXT    NOT NULL DEFAULT 'fixed', -- 'fixed' | 'metered'
  base_price_usd      REAL    NOT NULL DEFAULT 0,
  price_per_hour_usd  REAL,                       -- used when plan_type = 'metered'
  check_in_time       TEXT,
  check_out_time      TEXT,
  max_hours           INTEGER,
  max_guests          INTEGER,
  is_active           INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id)          REFERENCES hotels(id),
  FOREIGN KEY (pricing_config_id) REFERENCES facility_pricing_configs(id)
);

CREATE INDEX IF NOT EXISTS idx_fp_hotel_id   ON facility_plans(hotel_id);
CREATE INDEX IF NOT EXISTS idx_fp_active     ON facility_plans(hotel_id, is_active);

-- ③ プランオプション（追加料金・課金単位）
CREATE TABLE IF NOT EXISTS facility_plan_options (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  name_ja      TEXT,
  price_usd    REAL    NOT NULL DEFAULT 0,
  billing_unit TEXT    NOT NULL DEFAULT 'flat', -- 'flat' | 'per_person' | 'per_hour'
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES facility_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_fpo_plan_id ON facility_plan_options(plan_id);

-- ④ 予約時の料金内訳スナップショット
CREATE TABLE IF NOT EXISTS reservation_price_breakdowns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id          INTEGER NOT NULL UNIQUE,
  plan_type           TEXT,                        -- 'fixed' | 'metered'
  hours_billed        REAL,                        -- NULL for fixed plans
  adult_count         INTEGER NOT NULL DEFAULT 1,
  child_count         INTEGER NOT NULL DEFAULT 0,
  infant_count        INTEGER NOT NULL DEFAULT 0,
  base_price_usd      REAL    NOT NULL DEFAULT 0,
  adult_total_usd     REAL    NOT NULL DEFAULT 0,
  child_total_usd     REAL    NOT NULL DEFAULT 0,
  infant_total_usd    REAL    NOT NULL DEFAULT 0,
  options_total_usd   REAL    NOT NULL DEFAULT 0,
  subtotal_usd        REAL    NOT NULL DEFAULT 0,
  processing_fee_usd  REAL    NOT NULL DEFAULT 0,
  service_fee_usd     REAL    NOT NULL DEFAULT 0,
  total_usd           REAL    NOT NULL DEFAULT 0,
  breakdown_json      TEXT,                        -- full line-item JSON for display
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE INDEX IF NOT EXISTS idx_rpb_booking_id ON reservation_price_breakdowns(booking_id);

-- ⑤ 既存 bookings テーブルへのカラム追加
ALTER TABLE bookings ADD COLUMN facility_plan_id      INTEGER;
ALTER TABLE bookings ADD COLUMN pricing_config_id     INTEGER;
ALTER TABLE bookings ADD COLUMN check_in_time_actual  TEXT;
ALTER TABLE bookings ADD COLUMN check_out_time_actual TEXT;
ALTER TABLE bookings ADD COLUMN hours_booked          REAL;
