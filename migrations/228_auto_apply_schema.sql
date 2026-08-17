-- Migration 228: Auto-Apply schema — profile storage + applied_via tracking
-- Issue #83

-- 1. Create auto_apply_profiles table
CREATE TABLE IF NOT EXISTS auto_apply_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_data JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  gdpr_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_auto_apply_profiles_user ON auto_apply_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_apply_profiles_active ON auto_apply_profiles(user_id, is_active);

-- 2. Add applied_via column to job_applications (backwards-compatible)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_applications' AND column_name = 'applied_via'
  ) THEN
    ALTER TABLE job_applications
    ADD COLUMN applied_via TEXT NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- 3. Add check constraint for applied_via values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'job_applications' AND constraint_name = 'chk_job_applications_applied_via'
  ) THEN
    ALTER TABLE job_applications
    ADD CONSTRAINT chk_job_applications_applied_via
    CHECK (applied_via IN ('manual', 'auto_apply'));
  END IF;
END $$;
