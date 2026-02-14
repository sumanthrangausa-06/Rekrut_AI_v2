module.exports = {
  name: '044_ai_onboarding_plans',
  async up(client) {
    // AI-generated onboarding plans (role-specific, multi-phase)
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_plans (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        role_title VARCHAR(255) NOT NULL,
        department VARCHAR(100),
        plan_data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'active',
        progress_pct NUMERIC(5,2) DEFAULT 0,
        total_tasks INTEGER DEFAULT 0,
        completed_tasks INTEGER DEFAULT 0,
        ai_memory JSONB DEFAULT '{}',
        started_at TIMESTAMP,
        target_completion DATE,
        completed_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Individual onboarding tasks within a plan
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_tasks (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES onboarding_plans(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        phase VARCHAR(50) NOT NULL,
        day_range VARCHAR(50),
        category VARCHAR(100),
        assigned_to VARCHAR(50) DEFAULT 'new_hire',
        depends_on INTEGER[],
        is_required BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        completed_at TIMESTAMP,
        completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Enhanced chat sessions with memory
    await client.query(`
      ALTER TABLE onboarding_chats
      ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES onboarding_plans(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS context_memory JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS total_messages INTEGER DEFAULT 0
    `);

    // Document intelligence results
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS ai_extraction JSONB,
      ADD COLUMN IF NOT EXISTS ai_validation JSONB,
      ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS completeness_score NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES onboarding_plans(id) ON DELETE SET NULL
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_company ON onboarding_plans(company_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_candidate ON onboarding_plans(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_status ON onboarding_plans(status);
      CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_plan ON onboarding_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_status ON onboarding_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_assigned ON onboarding_tasks(assigned_to);
    `);

    console.log('AI onboarding plans + tasks + enhanced chat + doc intelligence tables created');
  }
};
