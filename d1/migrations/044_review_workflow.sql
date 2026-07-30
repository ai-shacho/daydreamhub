-- Review workflow: complete the owner→DDH listing review loop.
-- review_requested_at (024) already exists = "Under review".
-- These two add the "Changes requested" state so admin can send a listing
-- back to the owner with feedback, and the owner can revise and re-request.
ALTER TABLE hotels ADD COLUMN review_changes_requested_at TEXT DEFAULT NULL;
ALTER TABLE hotels ADD COLUMN review_feedback TEXT DEFAULT NULL;
