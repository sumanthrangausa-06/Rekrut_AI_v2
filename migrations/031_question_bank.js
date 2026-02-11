// Question Bank & Mock Interview Sessions — Dynamic AI Coaching
module.exports = {
  name: 'question_bank_and_mock_sessions',
  up: async (client) => {
    // Question bank — stores AI-generated questions keyed by role/JD
    await client.query(`
      CREATE TABLE IF NOT EXISTS question_bank (
        id SERIAL PRIMARY KEY,
        role VARCHAR(255) NOT NULL,
        jd_hash VARCHAR(64),
        skills TEXT[],
        question_text TEXT NOT NULL,
        question_type VARCHAR(50) NOT NULL DEFAULT 'behavioral',
        difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
        key_points TEXT[] DEFAULT '{}',
        times_used INTEGER DEFAULT 0,
        avg_score NUMERIC(4,2),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qbank_role ON question_bank(role);
      CREATE INDEX IF NOT EXISTS idx_qbank_jd_hash ON question_bank(jd_hash);
      CREATE INDEX IF NOT EXISTS idx_qbank_type ON question_bank(question_type);
    `);

    // Mock interview sessions — conversational interview tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS mock_interview_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        target_role VARCHAR(255) NOT NULL,
        job_description TEXT,
        jd_hash VARCHAR(64),
        status VARCHAR(20) DEFAULT 'in_progress',
        question_ids INTEGER[] DEFAULT '{}',
        conversation JSONB DEFAULT '[]',
        current_question_index INTEGER DEFAULT 0,
        overall_score NUMERIC(4,2),
        overall_feedback JSONB,
        questions_asked INTEGER DEFAULT 0,
        follow_ups_asked INTEGER DEFAULT 0,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mock_sessions_user ON mock_interview_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_mock_sessions_status ON mock_interview_sessions(status);
    `);

    console.log('Question bank and mock interview sessions tables created');
  }
};
