// Migration: Job-Based AI Assessment Engine
// Links AI-generated assessments to jobs with multi-category questions, scoring, and conversational mode

module.exports = {
  name: '042_job_assessments',
  up: async (client) => {
    // Job assessments — AI-generated assessment templates linked to job postings
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_assessments (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        difficulty_level VARCHAR(20) DEFAULT 'auto',
        time_limit_minutes INTEGER DEFAULT 45,
        passing_score INTEGER DEFAULT 70,
        question_count INTEGER DEFAULT 0,
        categories JSONB DEFAULT '[]',
        ai_config JSONB DEFAULT '{}',
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Job assessment questions — individual questions in a job assessment
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_assessment_questions (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER REFERENCES job_assessments(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL,
        question_type VARCHAR(50) NOT NULL,
        question_text TEXT NOT NULL,
        options JSONB,
        correct_answer TEXT,
        rubric TEXT,
        explanation TEXT,
        difficulty_level INTEGER DEFAULT 3 CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
        points INTEGER DEFAULT 10,
        time_limit_seconds INTEGER DEFAULT 120,
        order_index INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Candidate assessment attempts — tracks a candidate taking a job assessment
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_assessment_attempts (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER REFERENCES job_assessments(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        application_id INTEGER,
        status VARCHAR(50) DEFAULT 'in_progress',
        current_question_index INTEGER DEFAULT 0,
        current_difficulty INTEGER DEFAULT 3,
        answers JSONB DEFAULT '[]',
        scores JSONB DEFAULT '{}',
        composite_score NUMERIC(5,2),
        category_scores JSONB DEFAULT '{}',
        ai_summary JSONB,
        time_spent_seconds INTEGER DEFAULT 0,
        tab_switches INTEGER DEFAULT 0,
        copy_paste_attempts INTEGER DEFAULT 0,
        time_anomalies INTEGER DEFAULT 0,
        anti_cheat_score INTEGER DEFAULT 100,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        scored_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Conversational assessment turns — for CAMEL-style follow-up conversations
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_conversations (
        id SERIAL PRIMARY KEY,
        attempt_id INTEGER REFERENCES job_assessment_attempts(id) ON DELETE CASCADE,
        question_id INTEGER REFERENCES job_assessment_questions(id) ON DELETE SET NULL,
        role VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_assessments_job ON job_assessments(job_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_assessment_questions_assessment ON job_assessment_questions(assessment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_assessment_attempts_assessment ON job_assessment_attempts(assessment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_assessment_attempts_candidate ON job_assessment_attempts(candidate_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assessment_conversations_attempt ON assessment_conversations(attempt_id)`);

    console.log('[migration] Job assessment engine tables created');
  }
};
