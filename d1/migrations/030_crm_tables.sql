-- Phase 2: CRM Tables Migration
-- Creates crm_leads and appointment_reports tables for CRM functionality
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS crm_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER,
  progress TEXT DEFAULT 'new',
  lost_reason TEXT,
  last_updated TEXT DEFAULT (datetime('now')),
  last_contact_date TEXT,
  expected_reply_date TEXT,
  follow_up_required INTEGER DEFAULT 0,
  contact_method TEXT,
  appointment_content TEXT,
  timezone TEXT,
  country TEXT,
  city TEXT,
  acquisition_date TEXT,
  acquirer TEXT,
  contact_person TEXT,
  position TEXT,
  appointment_jst TEXT,
  appointment_local TEXT,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  official_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

CREATE TABLE IF NOT EXISTS appointment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_lead_id INTEGER NOT NULL,
  report_type TEXT NOT NULL, -- 'アポ' or 'セットアップ'
  timestamp TEXT DEFAULT (datetime('now')),
  appointment_date TEXT,
  result TEXT,
  content TEXT,
  next_action_hotel TEXT,
  next_action_ddh TEXT,
  next_action_due_date TEXT,
  contact_detail TEXT,
  -- アポ specific fields
  decision_maker_present INTEGER,
  hotel_questions TEXT,
  ddh_answers TEXT,
  staff_attendance_days TEXT,
  contactable_time TEXT,
  payment_method TEXT,
  other_contact_method TEXT,
  direct_phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (crm_lead_id) REFERENCES crm_leads(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crm_leads_hotel_id ON crm_leads(hotel_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_progress ON crm_leads(progress);
CREATE INDEX IF NOT EXISTS idx_crm_leads_last_updated ON crm_leads(last_updated);
CREATE INDEX IF NOT EXISTS idx_crm_leads_follow_up ON crm_leads(follow_up_required);
CREATE INDEX IF NOT EXISTS idx_appointment_reports_lead_id ON appointment_reports(crm_lead_id);
CREATE INDEX IF NOT EXISTS idx_appointment_reports_type ON appointment_reports(report_type);
