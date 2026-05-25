// CRM Type Definitions for Daydreamhub
export interface CrmLead {
  id: number;
  hotel_id: number | null;
  progress: string;
  lost_reason: string | null;
  last_updated: string | null;
  last_contact_date: string | null;
  expected_reply_date: string | null;
  follow_up_required: number;
  contact_method: string | null;
  appointment_content: string | null;
  timezone: string | null;
  country: string | null;
  city: string | null;
  acquisition_date: string | null;
  acquirer: string | null;
  contact_person: string | null;
  position: string | null;
  appointment_jst: string | null;
  appointment_local: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  official_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AppointmentReport {
  id: number;
  crm_lead_id: number;
  report_type: 'アポ' | 'セットアップ';
  timestamp: string | null;
  appointment_date: string | null;
  result: string | null;
  content: string | null;
  next_action_hotel: string | null;
  next_action_ddh: string | null;
  next_action_due_date: string | null;
  contact_detail: string | null;
  decision_maker_present: number | null;
  hotel_questions: string | null;
  ddh_answers: string | null;
  staff_attendance_days: string | null;
  contactable_time: string | null;
  payment_method: string | null;
  other_contact_method: string | null;
  direct_phone: string | null;
  created_at: string | null;
}
