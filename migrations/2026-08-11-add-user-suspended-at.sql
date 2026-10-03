-- Migration: Add suspended_at timestamp to users table for team member suspension
-- Issue #157

ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP NULL;

-- Add index for efficient suspended user lookups
CREATE INDEX IF NOT EXISTS idx_users_suspended_at ON users(suspended_at) WHERE suspended_at IS NOT NULL;
