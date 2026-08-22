/**
 * Migration 073: Screening Questionnaire System (Issue #110)
 * Custom per-job questionnaire with AI evaluation, knockout questions, and recruiter overrides.
 */

exports.name = 'screening_questionnaire';

exports.up = async (client) => {
	console.log('[migration] Creating screening questionnaire tables...');

	// Questionnaires (one per job)
	await client.query(`
    CREATE TABLE IF NOT EXISTS screening_questionnaires (
      id SERIAL PRIMARY KEY,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      pass_threshold INTEGER DEFAULT 70 CHECK (pass_threshold >= 0 AND pass_threshold <= 100),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// Individual questions
	await client.query(`
    CREATE TABLE IF NOT EXISTS screening_questions (
      id SERIAL PRIMARY KEY,
      questionnaire_id INTEGER REFERENCES screening_questionnaires(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type VARCHAR(20) CHECK (question_type IN ('single_choice', 'multiple_choice', 'short_text', 'yes_no', 'numeric')),
      options JSONB DEFAULT NULL,
      is_knockout BOOLEAN DEFAULT false,
      knockout_answer JSONB DEFAULT NULL,
      order_index INTEGER DEFAULT 0,
      required BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// Candidate responses
	await client.query(`
    CREATE TABLE IF NOT EXISTS screening_responses (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES job_applications(id) ON DELETE CASCADE,
      candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      questionnaire_id INTEGER REFERENCES screening_questionnaires(id) ON DELETE CASCADE,
      answers JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'evaluated', 'rejected')),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      overall_score INTEGER,
      ai_explanation TEXT,
      knockout_triggered BOOLEAN DEFAULT false,
      knockout_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// AI evaluations per question
	await client.query(`
    CREATE TABLE IF NOT EXISTS screening_question_evaluations (
      id SERIAL PRIMARY KEY,
      response_id INTEGER REFERENCES screening_responses(id) ON DELETE CASCADE,
      question_id INTEGER REFERENCES screening_questions(id) ON DELETE CASCADE,
      score INTEGER CHECK (score >= 0 AND score <= 100),
      explanation TEXT,
      evaluated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// Recruiter overrides
	await client.query(`
    CREATE TABLE IF NOT EXISTS screening_overrides (
      id SERIAL PRIMARY KEY,
      response_id INTEGER REFERENCES screening_responses(id) ON DELETE CASCADE,
      recruiter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      original_decision VARCHAR(20),
      override_decision VARCHAR(20),
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// Add unique constraint on job_id (one questionnaire per job).
	// Postgres has no ADD CONSTRAINT IF NOT EXISTS, so a unique index gives the
	// same guarantee and is natively idempotent.
	await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS screening_questionnaires_job_id_unique
    ON screening_questionnaires(job_id)
  `);

	// Indexes
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_screening_q_job ON screening_questionnaires(job_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_screening_q_questions ON screening_questions(questionnaire_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_screening_resp_app ON screening_responses(application_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_screening_resp_candidate ON screening_responses(candidate_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_screening_eval_response ON screening_question_evaluations(response_id)`,
	);

	console.log('[migration] Screening questionnaire tables created');
};
