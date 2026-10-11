// =============================================================================
// Migration 251: Tenant isolation for biometric_audit_log (S-065 C1 fix)
// =============================================================================
//
// S-065 privacy review C1 (CRITICAL, open): GET /api/admin/biometric-audit
// allowed hiring_manager to read the GLOBAL audit log — any hiring manager
// could see which candidates other companies' recruiters accessed. The
// audit log is itself sensitive (who accessed whose biometrics).
//
// Fix: add a nullable company_id column so the read path can scope
// hiring_manager queries to their own company. Nullable because existing
// rows were written before tenant attribution existed; the read path
// excludes unattributed (NULL) rows from hiring_manager views (fail-closed).
//
// Safety:
//   - ADD COLUMN IF NOT EXISTS (idempotent)
//   - CREATE INDEX IF NOT EXISTS (idempotent)
// =============================================================================

module.exports = {
	name: '251_audit_log_company_id',
	up: async (client) => {
		await client.query(`
			ALTER TABLE biometric_audit_log
			ADD COLUMN IF NOT EXISTS company_id INTEGER;
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_biometric_audit_log_company_accessed
			ON biometric_audit_log (company_id, accessed_at DESC);
		`);
	},
	down: async (client) => {
		await client.query(`
			DROP INDEX IF EXISTS idx_biometric_audit_log_company_accessed;
		`);
		await client.query(`
			ALTER TABLE biometric_audit_log
			DROP COLUMN IF EXISTS company_id;
		`);
	},
};
