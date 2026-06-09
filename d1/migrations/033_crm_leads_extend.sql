-- Task #56: crm_leads に要件カラムを追加（030は適用済みのため ALTER で拡張）
-- hotel_name: 未登録ホテル用に必須（既存行のため DEFAULT '' を付与、必須はアプリ側で担保）
-- next_progress_date: 次回進捗日
-- ddh_staff: DDHアポ担当者
-- progress_detail: 案件進捗の詳細メモ

ALTER TABLE crm_leads ADD COLUMN hotel_name TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_leads ADD COLUMN next_progress_date TEXT;
ALTER TABLE crm_leads ADD COLUMN ddh_staff TEXT;
ALTER TABLE crm_leads ADD COLUMN progress_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_leads_hotel_name ON crm_leads(hotel_name);
CREATE INDEX IF NOT EXISTS idx_crm_leads_next_progress_date ON crm_leads(next_progress_date);
