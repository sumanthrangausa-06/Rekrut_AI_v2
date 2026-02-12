// Phase 3: Smart Profile + MemGPT-Style Memory + Enhanced Matching
module.exports = {
  name: '037_smart_profile_memory',
  up: async (pool) => {
    // ============================================================
    // 1. MemGPT-Style AI Memory System
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_memory (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        memory_type VARCHAR(50) NOT NULL DEFAULT 'observation',
        memory_key VARCHAR(200),
        memory_value TEXT NOT NULL,
        source VARCHAR(100),
        confidence DECIMAL(3,2) DEFAULT 0.80,
        access_count INTEGER DEFAULT 0,
        last_accessed TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_memory_type ON user_memory(user_id, memory_type);
      CREATE INDEX IF NOT EXISTS idx_user_memory_key ON user_memory(user_id, memory_key);
    `);

    // ============================================================
    // 2. Screening Answers (linked to candidate profile for reuse)
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS screening_answers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        question_id INTEGER REFERENCES question_bank(id) ON DELETE SET NULL,
        question_text TEXT NOT NULL,
        answer_text TEXT NOT NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        application_id INTEGER,
        reuse_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_screening_answers_user ON screening_answers(user_id);
      CREATE INDEX IF NOT EXISTS idx_screening_answers_question ON screening_answers(question_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_answers_user_question
        ON screening_answers(user_id, question_text) WHERE question_text IS NOT NULL;
    `);

    // ============================================================
    // 3. Recruiter Preferences (saved templates, patterns)
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruiter_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        default_job_template JSONB DEFAULT '{}',
        common_requirements JSONB DEFAULT '[]',
        posting_patterns JSONB DEFAULT '{}',
        preferred_screening_questions JSONB DEFAULT '[]',
        score_weights JSONB DEFAULT '{"skills": 0.45, "experience": 0.20, "omniscore": 0.25, "trust": 0.10}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ============================================================
    // 4. Extended Match Results with more dimensions
    // ============================================================
    await pool.query(`
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS experience_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS education_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS salary_fit_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS location_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS interview_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS assessment_score DECIMAL(5,2) DEFAULT 0;
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS dimension_breakdown JSONB DEFAULT '{}';
    `);

    // ============================================================
    // 5. OmniScore History for trending
    // ============================================================
    await pool.query(`
      ALTER TABLE score_history ADD COLUMN IF NOT EXISTS score_snapshot JSONB DEFAULT '{}';
    `);

    // ============================================================
    // 6. Recruiter Feedback on Candidates (calibrates scoring)
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruiter_feedback (
        id SERIAL PRIMARY KEY,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        feedback_type VARCHAR(20) NOT NULL DEFAULT 'neutral',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(recruiter_id, candidate_id, job_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_recruiter_feedback_candidate ON recruiter_feedback(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_recruiter_feedback_recruiter ON recruiter_feedback(recruiter_id);
    `);

    // ============================================================
    // 7. Extend candidate_profiles with more fields for auto-fill
    // ============================================================
    await pool.query(`
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS work_authorization VARCHAR(100);
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS visa_sponsorship_needed BOOLEAN DEFAULT false;
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS notice_period VARCHAR(50);
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS willing_to_relocate BOOLEAN DEFAULT false;
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS preferred_company_size JSONB DEFAULT '[]';
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS cover_letter_template TEXT;
    `);

    console.log('[migration] 037_smart_profile_memory complete');
  }
};
