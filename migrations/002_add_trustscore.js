// TrustScore Migration - Employer Credit Score System
module.exports = {
  name: 'add_trustscore_tables',
  up: async (client) => {
    // Companies table - extended company profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        email_domain VARCHAR(255),
        logo_url TEXT,
        website TEXT,
        description TEXT,
        industry VARCHAR(100),
        company_size VARCHAR(50),
        founded_year INTEGER,
        headquarters VARCHAR(255),
        linkedin_url TEXT,
        is_verified BOOLEAN DEFAULT false,
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // TrustScore main table - employer credibility score (0-1000)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trust_scores (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
        total_score INTEGER DEFAULT 500,
        verification_score INTEGER DEFAULT 0,
        job_authenticity_score INTEGER DEFAULT 0,
        hiring_ratio_score INTEGER DEFAULT 0,
        feedback_score INTEGER DEFAULT 0,
        behavior_score INTEGER DEFAULT 0,
        score_tier VARCHAR(50) DEFAULT 'new',
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // TrustScore components - individual score factors
    await client.query(`
      CREATE TABLE IF NOT EXISTS trust_score_components (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        component_type VARCHAR(50) NOT NULL,
        source_type VARCHAR(50),
        source_id INTEGER,
        points INTEGER NOT NULL,
        max_points INTEGER NOT NULL,
        weight DECIMAL(3,2) DEFAULT 1.0,
        decay_rate DECIMAL(3,2) DEFAULT 0.98,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);

    // TrustScore history
    await client.query(`
      CREATE TABLE IF NOT EXISTS trust_score_history (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        previous_score INTEGER,
        new_score INTEGER,
        change_amount INTEGER,
        change_reason VARCHAR(255),
        component_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Job analytics - track job performance
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_analytics (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        views INTEGER DEFAULT 0,
        applications INTEGER DEFAULT 0,
        interviews_scheduled INTEGER DEFAULT 0,
        offers_made INTEGER DEFAULT 0,
        offers_accepted INTEGER DEFAULT 0,
        last_view_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Candidate feedback on companies
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_feedback (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        interview_id INTEGER REFERENCES interviews(id) ON DELETE SET NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
        process_rating INTEGER CHECK (process_rating >= 1 AND process_rating <= 5),
        feedback_text TEXT,
        is_anonymous BOOLEAN DEFAULT true,
        feedback_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Scheduled interviews (recruiter-side)
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_interviews (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        scheduled_at TIMESTAMP NOT NULL,
        duration_minutes INTEGER DEFAULT 60,
        interview_type VARCHAR(50) DEFAULT 'video',
        meeting_link TEXT,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'scheduled',
        outcome VARCHAR(50),
        feedback JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Job applications
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'applied',
        resume_url TEXT,
        cover_letter TEXT,
        omniscore_at_apply INTEGER,
        recruiter_notes TEXT,
        applied_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(job_id, candidate_id)
      )
    `);

    // Add company_id to jobs table if not exists
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);

    // Add recruiter role fields to users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trust_score_company ON trust_scores(company_id);
      CREATE INDEX IF NOT EXISTS idx_trust_components_company ON trust_score_components(company_id);
      CREATE INDEX IF NOT EXISTS idx_job_analytics_job ON job_analytics(job_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_feedback_company ON candidate_feedback(company_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_company ON scheduled_interviews(company_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_date ON scheduled_interviews(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_applications_candidate ON job_applications(candidate_id);
    `);

    console.log('TrustScore tables created successfully');
  }
};
