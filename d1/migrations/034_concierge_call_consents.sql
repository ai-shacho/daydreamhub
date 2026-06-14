-- Add explicit consent tracking fields for IVR booking confirmation
ALTER TABLE concierge_calls ADD COLUMN consent_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE concierge_calls ADD COLUMN consent_date INTEGER NOT NULL DEFAULT 0;
ALTER TABLE concierge_calls ADD COLUMN consent_time INTEGER NOT NULL DEFAULT 0;
ALTER TABLE concierge_calls ADD COLUMN consent_onsite_payment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE concierge_calls ADD COLUMN result_email_sent INTEGER NOT NULL DEFAULT 0;
