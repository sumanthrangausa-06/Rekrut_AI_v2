-- Migration: Issue #135 — Aadhaar/PAN identity verification for India market
-- Verhoeff checksum validation, OTP flow stubs, offline XML, consent management

-- 1. Create identity_verifications table
-- NEVER stores full Aadhaar/PAN — only masked value + SHA-256 hash
CREATE TABLE IF NOT EXISTS identity_verifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('aadhaar', 'pan')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'otp_sent', 'verified', 'failed')),
  masked_value VARCHAR(50) NOT NULL,
  hash VARCHAR(64) NOT NULL, -- SHA-256 hex digest of full number
  consent_given BOOLEAN DEFAULT false,
  consent_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Unique partial index: one active verification per user + type
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_verifications_user_type_active
ON identity_verifications(user_id, type)
WHERE status != 'failed';

-- 3. Index on hash for lookup without storing full number
CREATE INDEX IF NOT EXISTS idx_identity_verifications_hash
ON identity_verifications(hash);

-- 4. Index on user_id for status lookups
CREATE INDEX IF NOT EXISTS idx_identity_verifications_user_id
ON identity_verifications(user_id);
