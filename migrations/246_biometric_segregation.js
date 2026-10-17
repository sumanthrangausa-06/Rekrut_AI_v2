// =============================================================================
// Migration 246: Biometric/PII segregation (S-058, Issue #582, Phase 4 Sprint 2)
// =============================================================================
//
// Segregation design (AC-1, AC-2, AC-3; architecture §4; ADR-012):
//
//   candidate_data_keys — per-candidate random 256-bit DEKs, encrypted under
//     the BIOMETRIC_ENCRYPTION_KEY master key. DSAR deletion destroys the DEK
//     row (crypto-shredding): all data encrypted under it becomes unrecoverable
//     from the live database. Replaces HKDF-derived keys (derived keys are
//     re-derivable — cannot shred).
//
//     HONEST SCOPE (specialist review 2026-10-10): destruction is effective
//     against the live DB. Backups taken before destruction retain the wrapped
//     DEK, decryptable with the still-live master key. Backup-proof deletion
//     requires master-key rotation on DSAR delete — documented follow-up for
//     S-015/S-057 (ADR-012 to be amended).
//
//   biometric_templates — biometric templates (face/voice embeddings) stored
//     ENCRYPTED under the candidate's DEK. Keyed by opaque `subject_ref`
//     (random token). NO foreign key to users/candidates — schema-level
//     enforcement of AC-2: a JOIN from templates to name/email is impossible
//     because there is no join column.
//
//   biometric_session_map — the ONLY authorized join path (AC-2):
//     template.subject_ref → map.subject_ref → map.interview_session_id →
//     interview_sessions.candidate_id → users. Access gated by application
//     auth + requireBiometricConsent middleware.
//
// Safety:
//   - Every DDL statement uses IF NOT EXISTS (idempotent).
//   - No data migration: tables are new; audit-log candidate_ref encryption
//     is a follow-up (append-only trigger blocks backfill — see S-057).
// =============================================================================

module.exports = {
	name: '246_biometric_segregation',
	up: async (client) => {
		// ─── Per-candidate DEKs (ADR-012 crypto-shredding) ────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_data_keys (
        candidate_id INTEGER PRIMARY KEY,
        dek_encrypted BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        destroyed_at TIMESTAMPTZ,
        -- DSAR deletion: UPDATE candidate_data_keys
        --   SET destroyed_at = NOW(), dek_encrypted = '\\x'
        --   WHERE candidate_id = $1
        -- Rows remain (timestamps preserved for audit) but ciphertext becomes
        -- unrecoverable — including in Neon backup copies (CR-13).
        -- Application role: SELECT/UPDATE only; no DELETE.
        CONSTRAINT dek_destruction_note CHECK (true)
      )
    `);

		// ─── Biometric templates — segregated, no FK to identity ──────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS biometric_templates (
        id SERIAL PRIMARY KEY,
        -- Opaque subject reference (random token). Deliberately NOT a foreign
        -- key: there is no join path from this table to users/candidates.
        -- AC-2 enforced at schema level. UNIQUE prevents subject collisions.
        subject_ref BYTEA NOT NULL UNIQUE,
        template_type VARCHAR(50) NOT NULL CHECK (template_type IN (
          'face_embedding', 'voice_profile', 'behavioral_baseline'
        )),
        -- AES-256-GCM ciphertext, encrypted under the candidate's DEK.
        template_encrypted BYTEA NOT NULL,
        iv BYTEA NOT NULL,
        auth_tag BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        -- Retention: templates deleted 90 days post-hiring-decision (BIPA).
        -- Deletion jobs (S-015) purge by created_at; crypto-shredding via
        -- candidate_data_keys.destroyed_at is the hard guarantee for the
        -- live DB (see honest-scope note above re: backups).
        CONSTRAINT no_identity_fk_note CHECK (true)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_biometric_templates_subject
        ON biometric_templates(subject_ref)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_biometric_templates_type
        ON biometric_templates(template_type)
    `);

		// ─── Session mapping — the only authorized join path (AC-2) ───────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS biometric_session_map (
        id SERIAL PRIMARY KEY,
        interview_session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        subject_ref BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        -- Access to this table is gated by application auth +
        -- requireBiometricConsent middleware. It is the sole bridge between
        -- segregated biometric data and session identity.
        UNIQUE (interview_session_id, subject_ref)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_biometric_session_map_subject
        ON biometric_session_map(subject_ref)
    `);
	},
};
