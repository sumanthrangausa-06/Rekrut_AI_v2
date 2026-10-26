// =============================================================================
// Migration 267: biometric_audit_log user_role CHECK — add 'system' (#1194)
// =============================================================================
//
// Root cause (#1194): migration 243 created biometric_audit_log.user_role
// with CHECK (candidate|recruiter|employer|admin|hiring_manager) — the roles
// a real user can hold. Context-free audit writes have no acting user: the
// storage-drain aggregate entry in lib/erasureService.js
// (deleteErasedStorageFiles) defaults to userRole 'system' when no audit
// context is supplied, so every context-free drain run violated the CHECK
// and its audit entry was silently lost (the drain's catch only logged to
// console). The actor really was the system — the fix tells the truth in
// the log instead of borrowing a human role ('admin'/'candidate' would be
// a false statement in an append-only, 7-year-retained compliance log).
//
// Sumanth ruled Option 1 (2026-10-17, issue #1194 comment 6238356158):
// widen the CHECK to include 'system', plus loud app-side validation in
// lib/biometricAudit.js (VALID_ROLES mirrors this list).
//
// Semantics of a 'system' row: user_id / candidate_id name the DATA
// SUBJECT whose data the system action concerned — there is no system
// user, and the row must never be read as the subject (or any human)
// having acted. Reader surfaces are unchanged: 'system' rows written by
// the drain carry company_id NULL, so fail-closed hiring_manager views
// exclude them; they remain admin-visible only.
//
// Widen-only, following migration 245's precedent for the action CHECK:
// find the existing user_role CHECK by pattern, drop it, re-add it with
// the original five roles plus 'system'. No table/column drops, no data
// change. Idempotent: re-running drops the (possibly already widened)
// CHECK — it still matches the pattern — and re-adds the same list.
// Fresh installs: migrate.js runs files in lexical order, so 267 runs
// after 243 (table creation) and 245 (action widening).
// =============================================================================

module.exports = {
	name: '267_biometric_audit_log_system_role',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        chk_name TEXT;
      BEGIN
        -- Match the user_role CHECK by its distinctive values: only this
        -- constraint on biometric_audit_log names both the column and
        -- 'hiring_manager' (the action CHECK and CHECK(true) note do not).
        SELECT conname INTO chk_name
        FROM pg_constraint
        WHERE conrelid = 'biometric_audit_log'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%user_role%'
          AND pg_get_constraintdef(oid) LIKE '%hiring_manager%';
        IF chk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE biometric_audit_log DROP CONSTRAINT %I', chk_name);
        END IF;
      END
      $$;
    `);

		await client.query(`
      ALTER TABLE biometric_audit_log
        ADD CONSTRAINT biometric_audit_log_user_role_check
        CHECK (user_role IN (
          'candidate', 'recruiter', 'employer', 'admin', 'hiring_manager',
          'system'
        ))
    `);

		console.log(
			"Migration 267: biometric_audit_log user_role CHECK now also allows 'system' (#1194)",
		);
	},
};
