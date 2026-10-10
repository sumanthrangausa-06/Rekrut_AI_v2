// =============================================================================
// Migration 245: Consent hardening (S-011, Issue #571)
//
// Addresses privacy-engineering review findings:
//
// C2. consent_receipts.interview_session_id FK → interview_sessions(id) blocks
//     receipts for legacy mock_interview_sessions rows. Drop the FK; keep the
//     column as a plain INTEGER. S-001 (unified interview_sessions) will
//     re-establish referential integrity when session tables unify.
//
// M1. consent_texts is mutable — an UPDATE to text/effective_from would silently
//     change what was consented to, defeating the version-staleness mechanism.
//     Add an append-only trigger: new versions are INSERTed, never UPDATEd.
//     (Mirrors the biometric_audit_log trigger from migration 243.)
//
// M3. biometric_audit_log action enum lacks consent lifecycle actions —
//     recordConsent logged grants as 'view' (factually wrong). Add
//     consent_granted / consent_declined / consent_withdrawn.
// =============================================================================

module.exports = {
	name: '245_consent_hardening',
	up: async (client) => {
		// ─── C2: drop the FK to interview_sessions ───────────────────────────
		// Find and drop the FK constraint on consent_receipts.interview_session_id.
		await client.query(`
      DO $$
      DECLARE
        fk_name TEXT;
      BEGIN
        SELECT conname INTO fk_name
        FROM pg_constraint
        WHERE conrelid = 'consent_receipts'::regclass
          AND contype = 'f'
          AND conkey = (SELECT ARRAY[attnum] FROM pg_attribute
                        WHERE attrelid = 'consent_receipts'::regclass
                          AND attname = 'interview_session_id');
        IF fk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE consent_receipts DROP CONSTRAINT %I', fk_name);
        END IF;
      END
      $$;
    `);

		// ─── M1: consent_texts append-only trigger ───────────────────────────
		await client.query(`
      CREATE OR REPLACE FUNCTION prevent_consent_text_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'consent_texts is append-only: % not allowed. INSERT a new version instead.', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);

		await client.query(`
      DROP TRIGGER IF EXISTS trg_consent_texts_no_update ON consent_texts
    `);

		await client.query(`
      CREATE TRIGGER trg_consent_texts_no_update
        BEFORE UPDATE OR DELETE ON consent_texts
        FOR EACH ROW EXECUTE FUNCTION prevent_consent_text_mutation()
    `);

		// ─── M3: extend biometric_audit_log action enum ──────────────────────
		// The CHECK constraint lists allowed actions; replace it with an
		// expanded list. (Postgres CHECK constraints can't be altered in place
		// without knowing the name, so drop + re-add.)
		await client.query(`
      DO $$
      DECLARE
        chk_name TEXT;
      BEGIN
        -- Match the action CHECK by its distinctive values ('purge' only appears here).
        SELECT conname INTO chk_name
        FROM pg_constraint
        WHERE conrelid = 'biometric_audit_log'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%purge%';
        IF chk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE biometric_audit_log DROP CONSTRAINT %I', chk_name);
        END IF;
      END
      $$;
    `);

		await client.query(`
      ALTER TABLE biometric_audit_log
        ADD CONSTRAINT biometric_audit_log_action_check
        CHECK (action IN (
          'view', 'export', 'delete', 'purge',
          'consent_granted', 'consent_declined', 'consent_withdrawn'
        ))
    `);
	},
};
