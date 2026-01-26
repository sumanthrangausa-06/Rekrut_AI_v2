module.exports = {
  name: '014_onboarding_system',
  async up(client) {
    // Offer letters table
    await client.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        salary DECIMAL(10,2) NOT NULL,
        start_date DATE,
        benefits TEXT,
        template_data JSONB,
        status VARCHAR(50) DEFAULT 'draft',
        sent_at TIMESTAMP,
        viewed_at TIMESTAMP,
        accepted_at TIMESTAMP,
        declined_at TIMESTAMP,
        decline_reason TEXT,
        signature_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Onboarding checklists
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_checklists (
        id SERIAL PRIMARY KEY,
        offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        items JSONB DEFAULT '[]',
        completed_items JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'pending',
        due_date DATE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Document collection for onboarding
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_documents (
        id SERIAL PRIMARY KEY,
        checklist_id INTEGER REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        document_type VARCHAR(100) NOT NULL,
        document_url TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        uploaded_at TIMESTAMP,
        verified_at TIMESTAMP,
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Post-hire feedback tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS post_hire_feedback (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        feedback_type VARCHAR(50) NOT NULL,
        day_mark INTEGER,
        questions JSONB,
        responses JSONB,
        satisfaction_score INTEGER,
        would_recommend BOOLEAN,
        comments TEXT,
        ai_analysis JSONB,
        status VARCHAR(50) DEFAULT 'pending',
        sent_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Company policies for AI Q&A
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_policies (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        embeddings vector(1536),
        effective_date DATE,
        version INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Onboarding AI chat sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_chats (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        checklist_id INTEGER REFERENCES onboarding_checklists(id) ON DELETE SET NULL,
        messages JSONB DEFAULT '[]',
        session_started TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Offer letter templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_templates (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        template_html TEXT NOT NULL,
        variables JSONB DEFAULT '[]',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_offers_candidate ON offers(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
      CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_candidate ON onboarding_checklists(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_post_hire_feedback_employee ON post_hire_feedback(employee_id);
      CREATE INDEX IF NOT EXISTS idx_post_hire_feedback_day_mark ON post_hire_feedback(day_mark);
      CREATE INDEX IF NOT EXISTS idx_company_policies_company ON company_policies(company_id);
    `);

    console.log('Onboarding system tables created successfully');
  }
};
