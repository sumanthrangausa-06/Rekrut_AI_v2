/**
 * Migration 068: Identity Verification System
 * 
 * Creates tables for government ID verification with encryption at rest:
 * - verification_requests: Tracks ID upload, OCR, face match, review workflow
 * - verification_audit_log: Immutable audit trail for compliance (GDPR/AI Act)
 * 
 * Security design:
 * - Images are encrypted before storage (AES-256-GCM)
 * - Only encrypted paths are stored in DB, never raw image URLs
 * - Audit log captures every access with IP and actor context
 * - Expires_at enables automatic data retention cleanup
 */
module.exports = {
  name: '068_identity_verification',
  up: async (client) => {
    // ─── verification_requests ──────────────────────────────────────
    // Tracks the full identity verification lifecycle for a candidate.
    // Status machine: pending → ocr_processing → face_match → review → approved|rejected
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_requests (
        id              SERIAL PRIMARY KEY,
        candidate_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status          VARCHAR(32) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'ocr_processing', 'face_match', 'review', 'approved', 'rejected')),
        id_document_type VARCHAR(32)
          CHECK (id_document_type IN ('passport', 'drivers_license', 'national_id', 'residence_permit', 'other')),
        id_document_encrypted_url TEXT NOT NULL,
        selfie_encrypted_url      TEXT NOT NULL,
        extracted_data    JSONB DEFAULT '{}',
        confidence_score  DECIMAL(5,2),
        failure_reason    TEXT,
        reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
      )
    `);

    // Indexes for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_requests_candidate_id
      ON verification_requests(candidate_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_requests_status
      ON verification_requests(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_requests_created_at
      ON verification_requests(created_at DESC)
    `);
    // Composite index for common recruiter queries: "show me pending reviews"
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_requests_status_created
      ON verification_requests(status, created_at DESC)
    `);

    // ─── verification_audit_log ─────────────────────────────────────
    // Immutable compliance audit trail. Every view, upload, approval, rejection is logged.
    // Designed for GDPR Article 30 (records of processing) and EU AI Act audit requirements.
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_audit_log (
        id              SERIAL PRIMARY KEY,
        verification_id INTEGER NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
        actor_id        INTEGER,
        actor_type      VARCHAR(16) NOT NULL
          CHECK (actor_type IN ('system', 'candidate', 'recruiter', 'admin')),
        action          VARCHAR(16) NOT NULL
          CHECK (action IN ('upload', 'view', 'approve', 'reject', 'auto_check', 'delete')),
        metadata        JSONB DEFAULT '{}',
        ip_address      INET,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Indexes for audit log
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_audit_verification_id
      ON verification_audit_log(verification_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_audit_actor_id
      ON verification_audit_log(actor_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_audit_created_at
      ON verification_audit_log(created_at DESC)
    `);

    // Add comment for schema documentation
    await client.query(`
      COMMENT ON TABLE verification_requests IS 
      'Government ID verification workflow. Images encrypted at rest. Never expose raw URLs to recruiters.'
    `);
    await client.query(`
      COMMENT ON TABLE verification_audit_log IS 
      'Immutable audit trail for identity verification. Required for GDPR Article 30 and EU AI Act compliance.'
    `);

    console.log('[migration-068] Identity verification tables created');
  },

  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS verification_audit_log');
    await client.query('DROP TABLE IF EXISTS verification_requests');
    console.log('[migration-068] Identity verification tables dropped');
  },
};
