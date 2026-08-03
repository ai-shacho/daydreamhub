-- Two-call concierge model: call 1 produces a quote the guest accepts by email,
-- which (after a $7 PayPal fee) triggers call 2 to confirm the booking.
ALTER TABLE concierge_calls ADD COLUMN accept_token TEXT DEFAULT NULL;
ALTER TABLE concierge_calls ADD COLUMN quote_email_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE concierge_calls ADD COLUMN guest_accepted_at TEXT DEFAULT NULL;
ALTER TABLE concierge_calls ADD COLUMN fee_payment_status TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_concierge_calls_accept_token ON concierge_calls(accept_token);
