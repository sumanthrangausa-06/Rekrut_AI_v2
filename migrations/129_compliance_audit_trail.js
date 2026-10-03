// Migration 129: Compliance Audit Trail with Hash Chain
// Issue #136 — Tamper-evident audit trail for EU AI Act compliance

async function up(client) {
	// Create the compliance audit trail table
	// Uses UUID primary key for audit records; INTEGER FKs to match existing schema
	await client.query(`
    CREATE TABLE IF NOT EXISTS compliance_audit_trail (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type VARCHAR(50) NOT NULL
        CHECK (event_type IN ('ai_decision', 'human_override', 'data_access', 'verification', 'signature', 'status_change')),
      entity_type VARCHAR(50) NOT NULL
        CHECK (entity_type IN ('candidate', 'job', 'company', 'user')),
      entity_id INTEGER NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_role VARCHAR(50),
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      payload JSONB NOT NULL DEFAULT '{}',
      previous_hash VARCHAR(64) NOT NULL,
      current_hash VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

	// Indexes for all query dimensions
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_entity
      ON compliance_audit_trail(entity_type, entity_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_actor
      ON compliance_audit_trail(actor_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_job
      ON compliance_audit_trail(job_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_company
      ON compliance_audit_trail(company_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_created_at
      ON compliance_audit_trail(created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_event_type
      ON compliance_audit_trail(event_type, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_hash
      ON compliance_audit_trail(current_hash)
  `);

	// Partial index for regulator exports (fast date-range by company)
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cat_company_date
      ON compliance_audit_trail(company_id, created_at DESC)
      WHERE company_id IS NOT NULL
  `);

	// Comment for documentation
	await client.query(`
    COMMENT ON TABLE compliance_audit_trail IS 'Tamper-evident compliance audit trail (Issue #136). Append-only. Hash-chained.'
  `);

	console.log('[migration 129] compliance_audit_trail table created with hash chain');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS compliance_audit_trail CASCADE');
	console.log('[migration 129] compliance_audit_trail table dropped');
}

module.exports = { up, down };
