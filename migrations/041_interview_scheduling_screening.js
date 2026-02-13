// Migration 041: AI Interview Scheduling, Screening Pipeline, Multi-Evaluator tables
module.exports = {
  up: async (client) => {
    // Screening interview templates (recruiter creates per job)
    await client.query(`
      CREATE TABLE IF NOT EXISTS screening_templates (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        questions JSONB NOT NULL DEFAULT '[]',
        time_limit_minutes INTEGER DEFAULT 45,
        auto_send_on_apply BOOLEAN DEFAULT false,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // AI Screening sessions (candidate completes async)
    await client.query(`
      CREATE TABLE IF NOT EXISTS screening_sessions (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES screening_templates(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
        invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        invite_token VARCHAR(128) UNIQUE,
        questions JSONB NOT NULL DEFAULT '[]',
        responses JSONB DEFAULT '[]',
        conversation JSONB DEFAULT '[]',
        ai_report JSONB,
        overall_score NUMERIC(5,2),
        status VARCHAR(50) DEFAULT 'invited',
        invited_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Multi-evaluator AI scores per interview/screening
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_evaluations (
        id SERIAL PRIMARY KEY,
        interview_id INTEGER,
        screening_session_id INTEGER,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        evaluator_type VARCHAR(50) NOT NULL,
        score NUMERIC(5,2) NOT NULL,
        max_score NUMERIC(5,2) DEFAULT 100,
        breakdown JSONB,
        reasoning TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Composite evaluation (synthesis of all evaluators)
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_composite_scores (
        id SERIAL PRIMARY KEY,
        interview_id INTEGER,
        screening_session_id INTEGER,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        technical_score NUMERIC(5,2),
        culture_score NUMERIC(5,2),
        experience_score NUMERIC(5,2),
        composite_score NUMERIC(5,2),
        recommendation VARCHAR(50),
        recommendation_reasoning TEXT,
        recruiter_score NUMERIC(5,2),
        calibration_delta NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Smart scheduling: recruiter availability patterns
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduling_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        timezone VARCHAR(100) DEFAULT 'America/New_York',
        available_days JSONB DEFAULT '["monday","tuesday","wednesday","thursday","friday"]',
        available_hours JSONB DEFAULT '{"start": "09:00", "end": "17:00"}',
        buffer_minutes INTEGER DEFAULT 15,
        preferred_duration INTEGER DEFAULT 60,
        blackout_dates JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Interview reminders
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_reminders (
        id SERIAL PRIMARY KEY,
        interview_id INTEGER REFERENCES scheduled_interviews(id) ON DELETE CASCADE,
        recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reminder_type VARCHAR(50) NOT NULL,
        send_at TIMESTAMP NOT NULL,
        sent BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add screening_status to job_applications if not exists
    await client.query(`
      ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS screening_status VARCHAR(50) DEFAULT NULL
    `);
    await client.query(`
      ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS screening_score NUMERIC(5,2) DEFAULT NULL
    `);

    // Add ai_evaluation to scheduled_interviews
    await client.query(`
      ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS ai_evaluation JSONB DEFAULT NULL
    `);
    await client.query(`
      ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS ai_composite_score NUMERIC(5,2) DEFAULT NULL
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_screening_templates_job ON screening_templates(job_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_candidate ON screening_sessions(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_job ON screening_sessions(job_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_status ON screening_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_token ON screening_sessions(invite_token);
      CREATE INDEX IF NOT EXISTS idx_interview_evaluations_candidate ON interview_evaluations(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_interview_evaluations_screening ON interview_evaluations(screening_session_id);
      CREATE INDEX IF NOT EXISTS idx_interview_composite_candidate ON interview_composite_scores(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_scheduling_prefs_user ON scheduling_preferences(user_id);
      CREATE INDEX IF NOT EXISTS idx_interview_reminders_send ON interview_reminders(send_at) WHERE sent = false;
    `);

    console.log('Migration 041: Interview scheduling, screening & evaluation tables created');
  }
};
