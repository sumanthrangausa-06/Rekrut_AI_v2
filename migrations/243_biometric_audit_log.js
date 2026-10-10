// =============================================================================
// Migration 243: Biometric audit log (S-014, Issue #573, Phase 4 Sprint 1)
// =============================================================================
//
// New table:
//   biometric_audit_log — append-only log of every biometric data access.
//   One row per access: [timestamp] [user_id] [role] [view|export|delete|purge]
//   [data_type] [candidate_id].
//
// Append-only enforcement:
//   - DB trigger `trg_biometric_audit_log_no_update` blocks UPDATE and DELETE
//     at the database level (RAISE EXCEPTION in BEFORE trigger).
//   - REVOKE TRUNCATE from the app role (TRUNCATE bypasses row triggers).
//   - Application role should additionally be granted INSERT/SELECT only
//     (managed outside this migration, in role setup).
//
// Retention: audit logs retained 7 years per compliance policy. Deletion jobs
// (S-015) MUST NOT purge rows newer than 7 years.
//
// Follow-up (out of scope for S-014): encrypt candidate_id via per-candidate
// DEK (see architecture ADR-012 crypto-shredding). Currently plain FK.
//
// Safety:
//   - Every DDL statement uses IF NOT EXISTS / OR REPLACE (idempotent).
// =============================================================================

module.exports = {
	name: '243_biometric_audit_log',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS biometric_audit_log (
        id SERIAL PRIMARY KEY,
        accessed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        user_id INTEGER NOT NULL,
        user_role VARCHAR(50) NOT NULL CHECK (user_role IN (
          'candidate', 'recruiter', 'employer', 'admin', 'hiring_manager'
        )),
        action VARCHAR(20) NOT NULL CHECK (action IN ('view', 'export', 'delete', 'purge')),
        data_type VARCHAR(50) NOT NULL,
        candidate_id INTEGER NOT NULL,
        ip_address INET,
        -- Retention: 7 years per compliance policy (BIPA backstop: 3 years;
        -- audit trail kept longer for regulatory defense). Deletion jobs must
        -- not purge rows where accessed_at > NOW() - INTERVAL '7 years'.
        CONSTRAINT audit_retention_note CHECK (true)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_time ON biometric_audit_log(accessed_at)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_user ON biometric_audit_log(user_id)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_candidate ON biometric_audit_log(candidate_id)
    `);

		// ─── Append-only trigger ──────────────────────────────────────────────
		await client.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'biometric_audit_log is append-only: % not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);

		await client.query(`
      DROP TRIGGER IF EXISTS trg_biometric_audit_log_no_update ON biometric_audit_log
    `);

		await client.query(`
      CREATE TRIGGER trg_biometric_audit_log_no_update
        BEFORE UPDATE OR DELETE ON biometric_audit_log
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation()
    `);

		// TRUNCATE bypasses row-level triggers — revoke from app roles.
		// NOTE: role name must match the app's DB role in each environment.
		// Wrapped in DO block so missing roles don't fail the migration.
		await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rekrut_app') THEN
          REVOKE TRUNCATE ON biometric_audit_log FROM rekrut_app;
        END IF;
      END
      $$;
    `);
	},
};
