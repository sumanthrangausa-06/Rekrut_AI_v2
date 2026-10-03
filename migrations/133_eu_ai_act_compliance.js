// Migration 133: EU AI Act Compliance Backend — Issue #142
// Tables: job_risk_classifications, candidate_demographics, bias_metrics,
//         ai_decision_explanations, human_overrides, consent_history,
//         transparency_reports
//
module.exports = {
	name: '133_eu_ai_act_compliance',
	async up(client) {
		// ── 1. Job Risk Classifications ───────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS job_risk_classifications (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        risk_level VARCHAR(50) NOT NULL CHECK (risk_level IN ('minimal','limited','high','unacceptable')),
        risk_factors JSONB DEFAULT '[]',
        justification TEXT,
        assessed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assessed_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(job_id)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_job_risk_classifications_job_id ON job_risk_classifications(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_risk_classifications_level ON job_risk_classifications(risk_level);
    `);

		// ── 2. Candidate Demographics (voluntary, self-reported) ──────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_demographics (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gender VARCHAR(50),
        ethnicity VARCHAR(100),
        age_group VARCHAR(50),
        disability_status VARCHAR(50),
        reported_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_candidate_demographics_user_id ON candidate_demographics(user_id);
    `);

		// ── 3. Bias Metrics (per job posting) ────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS bias_metrics (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        metric_type VARCHAR(100) NOT NULL CHECK (metric_type IN ('four_fifths_rule','demographic_parity',' disparate_impact')),
        demographic_attribute VARCHAR(100) NOT NULL,
        group_breakdowns JSONB NOT NULL DEFAULT '[]',
        overall_ratio DECIMAL(5,4),
        flagged BOOLEAN DEFAULT false,
        threshold_used DECIMAL(3,2) DEFAULT 0.80,
        calculated_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(job_id, metric_type, demographic_attribute)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bias_metrics_job_id ON bias_metrics(job_id);
      CREATE INDEX IF NOT EXISTS idx_bias_metrics_flagged ON bias_metrics(flagged) WHERE flagged = true;
    `);

		// ── 4. AI Decision Explanations ──────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS ai_decision_explanations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
        overall_score DECIMAL(5,2),
        factor_breakdowns JSONB NOT NULL DEFAULT '[]',
        weights_hash VARCHAR(64),
        generated_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, job_id)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decision_explanations_user_job ON ai_decision_explanations(user_id, job_id);
      CREATE INDEX IF NOT EXISTS idx_ai_decision_explanations_job ON ai_decision_explanations(job_id);
    `);

		// ── 5. Human Overrides (tamper-evident via compliance_audit_trail) ────
		await client.query(`
      CREATE TABLE IF NOT EXISTS human_overrides (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        original_score DECIMAL(5,2),
        new_score DECIMAL(5,2),
        original_status VARCHAR(50),
        new_status VARCHAR(50),
        reason TEXT NOT NULL,
        overridden_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        overridden_at TIMESTAMP DEFAULT NOW(),
        audit_trail_id UUID REFERENCES compliance_audit_trail(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_overrides_application ON human_overrides(application_id);
      CREATE INDEX IF NOT EXISTS idx_human_overrides_job ON human_overrides(job_id);
      CREATE INDEX IF NOT EXISTS idx_human_overrides_overridden_by ON human_overrides(overridden_by);
      CREATE INDEX IF NOT EXISTS idx_human_overrides_created_at ON human_overrides(created_at);
    `);

		// ── 6. Consent History ───────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS consent_history (
        id SERIAL PRIMARY KEY,
        consent_record_id INTEGER NOT NULL REFERENCES consent_records(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        consent_type VARCHAR(100) NOT NULL,
        previous_value BOOLEAN,
        new_value BOOLEAN NOT NULL,
        changed_at TIMESTAMP DEFAULT NOW(),
        changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ip_address VARCHAR(45),
        user_agent TEXT
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_history_record ON consent_history(consent_record_id);
      CREATE INDEX IF NOT EXISTS idx_consent_history_user ON consent_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_consent_history_changed_at ON consent_history(changed_at);
    `);

		// ── 7. Transparency Reports ──────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS transparency_reports (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        report_type VARCHAR(50) NOT NULL DEFAULT 'regulator' CHECK (report_type IN ('regulator','internal')),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        risk_classifications_summary JSONB DEFAULT '{}',
        bias_metrics_summary JSONB DEFAULT '{}',
        override_summary JSONB DEFAULT '{}',
        consent_stats JSONB DEFAULT '{}',
        retention_compliance JSONB DEFAULT '{}',
        report_data JSONB DEFAULT '{}',
        generated_at TIMESTAMP DEFAULT NOW(),
        generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        format VARCHAR(10) DEFAULT 'json' CHECK (format IN ('json','pdf')),
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
        file_url TEXT
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transparency_reports_company ON transparency_reports(company_id);
      CREATE INDEX IF NOT EXISTS idx_transparency_reports_period ON transparency_reports(period_start, period_end);
      CREATE INDEX IF NOT EXISTS idx_transparency_reports_status ON transparency_reports(status);
    `);

		// ── 8. Enhance data_retention_policies for per-tenant scoping ─────────
		await client.query(`
      ALTER TABLE data_retention_policies
      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;
    `);
		await client.query(`
      ALTER TABLE data_retention_policies
      ADD COLUMN IF NOT EXISTS policy_scope VARCHAR(50) DEFAULT 'global' CHECK (policy_scope IN ('global','company','job'));
    `);
		await client.query(`
      ALTER TABLE data_retention_policies
      ADD COLUMN IF NOT EXISTS scope_id INTEGER;
    `);
		await client.query(`
      DROP INDEX IF EXISTS idx_data_retention_policies_data_type_unique;
    `);
		await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_data_retention_policies_scope_unique
      ON data_retention_policies(data_type, COALESCE(company_id, 0), COALESCE(scope_id, 0), policy_scope);
    `);

		// ── 9. Add consent revocation fields to consent_records ──────────────
		await client.query(`
      ALTER TABLE consent_records
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
    `);
		await client.query(`
      ALTER TABLE consent_records
      ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);
		await client.query(`
      ALTER TABLE consent_records
      ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
    `);

		console.log('EU AI Act compliance tables created (migration 133)');
	},
};
