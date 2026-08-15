-- Migration: Issue #134 — Document OCR and fraud detection enhancements
-- Adds tamper detection, cross-document consistency, human review queue, candidate appeal, and false positive tracking

-- 1. Create document_review_queue table for human review of flagged documents
CREATE TABLE IF NOT EXISTS document_review_queue (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES verification_documents(id) ON DELETE CASCADE UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fraud_risk VARCHAR(50) NOT NULL,
  fraud_flags JSONB DEFAULT '[]',
  review_status VARCHAR(50) DEFAULT 'pending',
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  appeal_reason TEXT,
  appealed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Add false_positive tracking to document_verifications
ALTER TABLE document_verifications
ADD COLUMN IF NOT EXISTS false_positive BOOLEAN DEFAULT false;

-- 3. Add pending_review status support to verification_documents
-- (status column already exists; application code will use 'pending_review' value)

-- 4. Indexes for review queue performance
CREATE INDEX IF NOT EXISTS idx_document_review_queue_status ON document_review_queue(review_status);
CREATE INDEX IF NOT EXISTS idx_document_review_queue_user ON document_review_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_document_review_queue_document ON document_review_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_document_review_queue_reviewer ON document_review_queue(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_document_review_queue_created ON document_review_queue(created_at);

-- 5. Index for false_positive lookups
CREATE INDEX IF NOT EXISTS idx_document_verifications_false_positive ON document_verifications(false_positive)
WHERE false_positive = true;
