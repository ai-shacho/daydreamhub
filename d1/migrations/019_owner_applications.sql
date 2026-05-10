-- Owner application submissions
CREATE TABLE IF NOT EXISTS owner_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_name TEXT NOT NULL,
  booking_email TEXT NOT NULL,
  hotel_phone TEXT NOT NULL,
  management_company TEXT DEFAULT '',
  site_url TEXT DEFAULT '',
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_method TEXT DEFAULT '',
  messenger_url TEXT DEFAULT '',
  whatsapp_url TEXT DEFAULT '',
  line_url TEXT DEFAULT '',
  other_sns_url TEXT DEFAULT '',
  payment_method TEXT DEFAULT '',
  paypal_account TEXT DEFAULT '',
  wise_account TEXT DEFAULT '',
  payoneer_account TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
