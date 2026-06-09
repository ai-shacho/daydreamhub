// CRM Type Definitions for Daydreamhub
export interface CrmLead {
  id: number;
  hotel_id: number | null;
  hotel_name: string;                 // ホテル名（必須・未登録ホテル対応）— Task #56
  progress: string;
  next_progress_date: string | null;  // 次回進捗日 — Task #56
  ddh_staff: string | null;           // DDHアポ担当者 — Task #56
  progress_detail: string | null;     // 案件進捗の詳細 — Task #56
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
