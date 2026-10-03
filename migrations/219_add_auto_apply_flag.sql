-- Migration 219: Add is_auto_applied flag to job_applications
-- Issue #33: Auto-Apply backend feature

ALTER TABLE job_applications
ADD COLUMN IF NOT EXISTS is_auto_applied BOOLEAN NOT NULL DEFAULT FALSE;
