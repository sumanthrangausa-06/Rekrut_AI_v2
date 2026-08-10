// Migration: Add audit_logs table for recruiter approvals and rejections (Issue #156)

async function up(client) {
	await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(50) NOT NULL,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
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

	console.log('[migration 070] audit_logs table created');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
	console.log('[migration 070] audit_logs table dropped');
}

module.exports = { up, down };
