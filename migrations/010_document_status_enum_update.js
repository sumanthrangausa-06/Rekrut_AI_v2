/**
 * Migration: Update document verification status enum + add encryption columns
 * Issue #115 — Candidate document management
 *
 * Changes:
 * 1. Add encryption metadata columns to verification_documents
 * 2. Create document_scan_logs table for virus scan audit trail
 * 3. Update existing status values: processed → verified, flagged → rejected
 * 4. verification_documents.status now uses: pending, verified, rejected, expired
 */

module.exports = {
  name: '010_document_status_enum_update',
  up: async (client) => {
    // 1. Add encryption metadata columns to verification_documents
    await client.query(`
      ALTER TABLE verification_documents
      ADD COLUMN IF NOT EXISTS encryption_iv VARCHAR(64),
      ADD COLUMN IF NOT EXISTS encryption_tag VARCHAR(64),
      ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(32)
    `);

    // 2. Create document scan logs table for virus scan audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_scan_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        filename VARCHAR(255),
        mime_type VARCHAR(100),
        clean BOOLEAN NOT NULL,
        findings JSONB DEFAULT '[]',
        scanned_at TIMESTAMP DEFAULT NOW(),
        ip_address VARCHAR(50),
        user_agent TEXT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_scan_logs_user
      ON document_scan_logs(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_scan_logs_scanned_at
      ON document_scan_logs(scanned_at)
    `);

    // 3. Migrate existing status values
    // processed → verified (document passed verification without high fraud risk)
    await client.query(`
      UPDATE verification_documents
      SET status = 'verified'
      WHERE status = 'processed'
    `);

    // flagged → rejected (document was flagged for fraud/rejected by verification)
    await client.query(`
      UPDATE verification_documents
      SET status = 'rejected'
      WHERE status = 'flagged'
    `);

    // Also update document_score_impacts verification_status references
    await client.query(`
      UPDATE document_score_impacts
      SET verification_status = 'verified'
      WHERE verification_status = 'processed'
    `);

    await client.query(`
      UPDATE document_score_impacts
      SET verification_status = 'rejected'
      WHERE verification_status = 'flagged'
    `);

    console.log('Document status enum updated: processed→verified, flagged→rejected');
    console.log('Encryption columns added to verification_documents');
    console.log('document_scan_logs table created');
  },
};
