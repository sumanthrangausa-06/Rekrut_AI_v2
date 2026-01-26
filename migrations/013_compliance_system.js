module.exports = {
  name: '013_compliance_system',
  async up(client) {
    // Audit logs - track all AI decisions and recruiter actions
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action_type VARCHAR(100) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_type VARCHAR(100),
        target_id INTEGER,
        metadata JSONB DEFAULT '{}',
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
    `);

    // Consent records - GDPR consent management
    await client.query(`
      CREATE TABLE IF NOT EXISTS consent_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        consent_type VARCHAR(100) NOT NULL,
        consented BOOLEAN DEFAULT false,
        consented_at TIMESTAMP,
        ip_address VARCHAR(45),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_records_user_id ON consent_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_consent_records_type ON consent_records(consent_type);
    `);

    // Data requests - Right to be forgotten, data export
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        request_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        export_url TEXT,
        notes TEXT,
        metadata JSONB DEFAULT '{}'
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_data_requests_user_id ON data_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_data_requests_status ON data_requests(status);
      CREATE INDEX IF NOT EXISTS idx_data_requests_type ON data_requests(request_type);
    `);

    // Bias reports - Demographic parity analysis
    await client.query(`
      CREATE TABLE IF NOT EXISTS bias_reports (
        id SERIAL PRIMARY KEY,
        report_date DATE NOT NULL,
        analysis_type VARCHAR(100) NOT NULL,
        findings JSONB NOT NULL,
        flagged_patterns JSONB DEFAULT '[]',
        recommendations JSONB DEFAULT '[]',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bias_reports_date ON bias_reports(report_date);
      CREATE INDEX IF NOT EXISTS idx_bias_reports_type ON bias_reports(analysis_type);
    `);

    // Fairness audits - Regular automated fairness reports
    await client.query(`
      CREATE TABLE IF NOT EXISTS fairness_audits (
        id SERIAL PRIMARY KEY,
        audit_date DATE NOT NULL,
        audit_type VARCHAR(100) NOT NULL,
        score_distribution JSONB NOT NULL,
        demographic_breakdowns JSONB DEFAULT '{}',
        appeal_stats JSONB DEFAULT '{}',
        overall_fairness_score DECIMAL(5,2),
        issues_found INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fairness_audits_date ON fairness_audits(audit_date);
      CREATE INDEX IF NOT EXISTS idx_fairness_audits_type ON fairness_audits(audit_type);
    `);

    // Appeals - Candidate appeal workflow
    await client.query(`
      CREATE TABLE IF NOT EXISTS score_appeals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        score_type VARCHAR(50) NOT NULL,
        original_score INTEGER,
        appeal_reason TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        resolution TEXT,
        new_score INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_score_appeals_user_id ON score_appeals(user_id);
      CREATE INDEX IF NOT EXISTS idx_score_appeals_status ON score_appeals(status);
    `);

    // Data retention settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_retention_policies (
        id SERIAL PRIMARY KEY,
        data_type VARCHAR(100) NOT NULL UNIQUE,
        retention_days INTEGER NOT NULL,
        auto_delete BOOLEAN DEFAULT false,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert default retention policies
    await client.query(`
      INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, description)
      VALUES
        ('audit_logs', 2555, false, 'Keep audit logs for 7 years for compliance'),
        ('interview_recordings', 730, true, 'Delete interview recordings after 2 years'),
        ('assessment_results', 1825, false, 'Keep assessment results for 5 years'),
        ('candidate_data', 1095, false, 'Keep inactive candidate data for 3 years')
      ON CONFLICT (data_type) DO NOTHING
    `);

    console.log('Compliance system tables created successfully');
  }
};
