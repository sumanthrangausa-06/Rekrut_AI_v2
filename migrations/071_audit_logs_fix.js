// Migration 071: Fix audit_logs columns for staging environments where 070 was a no-op
// Issue #156 — If 070_audit_logs was recorded but the table already existed, the ALTERs never ran.
// This migration unconditionally ensures the columns exist.

async function up(client) {
	await client.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
  `);
	await client.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  `);
	await client.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS action VARCHAR(50)
  `);
	await client.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS reason TEXT
  `);

	// Ensure indexes exist
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
      ON audit_logs(company_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action
      ON audit_logs(action, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
      ON audit_logs(actor_id, created_at DESC)
  `);

	console.log('[migration 071] audit_logs columns verified');
}

async function down(client) {
	// Intentionally no-op — do not drop columns that may hold production data
	console.log('[migration 071] down is no-op');
}

module.exports = { up, down };
