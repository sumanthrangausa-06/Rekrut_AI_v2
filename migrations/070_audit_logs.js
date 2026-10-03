// Migration: Add audit_logs columns for recruiter approvals and rejections (Issue #156)
// Table may already exist with old schema; add missing columns without touching existing ones.

async function up(client) {
	// Add missing columns to existing audit_logs table
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

	// Indexes for common query patterns
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

	console.log('[migration 070] audit_logs columns added');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
	console.log('[migration 070] audit_logs table dropped');
}

module.exports = { up, down };
