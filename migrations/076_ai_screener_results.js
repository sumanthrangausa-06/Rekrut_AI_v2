/**
 * Migration 076: AI Recruiter Screener Results (Issue #112)
 *
 * Creates tables for AI screening results, audit logging, and human reviews.
 * - ai_screenings: stores detailed AI screening results per candidate/job pair
 * - ai_screening_audit_logs: append-only, tamper-evident audit trail
 * - ai_screening_human_reviews: human override decisions on AI recommendations
 */

exports.name = 'ai_screener_results';

exports.up = async (client) => {
	console.log('[migration 076] Creating AI screener results schema...');

	// ─── ai_screenings: main screening results table ───
	await client.query(`
    CREATE TABLE IF NOT EXISTS ai_screenings (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
      fit_score INTEGER NOT NULL CHECK (fit_score >= 0 AND fit_score <= 100),
      fit_breakdown JSONB NOT NULL DEFAULT '{}',
      recommendation VARCHAR(20) NOT NULL CHECK (recommendation IN ('interview', 'reject', 'more_info', 'hold')),
      recommendation_reason TEXT,
      matched_skills TEXT[] DEFAULT '{}',
      missing_skills TEXT[] DEFAULT '{}',
      strengths TEXT[] DEFAULT '{}',
      concerns TEXT[] DEFAULT '{}',
      red_flags JSONB NOT NULL DEFAULT '[]',
      screening_questions JSONB NOT NULL DEFAULT '[]',
      interview_focus_areas TEXT[] DEFAULT '{}',
      estimated_success_probability INTEGER CHECK (estimated_success_probability >= 0 AND estimated_success_probability <= 100),
      raw_screening_data JSONB,
      screened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      human_review_status VARCHAR(20) DEFAULT 'pending' CHECK (human_review_status IN ('pending', 'approved', 'overridden', 'requested')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(job_id, candidate_id)
    )
  `);

	// ─── ai_screening_audit_logs: append-only, tamper-evident ───
	await client.query(`
    CREATE TABLE IF NOT EXISTS ai_screening_audit_logs (
      id SERIAL PRIMARY KEY,
      screening_id INTEGER NOT NULL REFERENCES ai_screenings(id) ON DELETE CASCADE,
      action VARCHAR(50) NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      inputs_hash VARCHAR(64),
      outputs_hash VARCHAR(64),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// ─── ai_screening_human_reviews: human override decisions ───
	await client.query(`
    CREATE TABLE IF NOT EXISTS ai_screening_human_reviews (
      id SERIAL PRIMARY KEY,
      screening_id INTEGER NOT NULL REFERENCES ai_screenings(id) ON DELETE CASCADE,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      decision VARCHAR(20) NOT NULL CHECK (decision IN ('interview', 'reject', 'more_info', 'hold')),
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(screening_id, reviewer_id)
    )
  `);

	// ─── Indexes for fast lookups ───
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screenings_job_id
      ON ai_screenings(job_id)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screenings_candidate_id
      ON ai_screenings(candidate_id)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screenings_job_candidate
      ON ai_screenings(job_id, candidate_id)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screenings_fit_score
      ON ai_screenings(fit_score DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screenings_created_at
      ON ai_screenings(created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screening_audit_logs_screening_id
      ON ai_screening_audit_logs(screening_id, created_at DESC)
  `);
	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_screening_human_reviews_screening_id
      ON ai_screening_human_reviews(screening_id)
  `);

	console.log('[migration 076] AI screener results schema created');
};

exports.down = async (client) => {
	await client.query('DROP INDEX IF EXISTS idx_ai_screening_human_reviews_screening_id');
	await client.query('DROP INDEX IF EXISTS idx_ai_screening_audit_logs_screening_id');
	await client.query('DROP INDEX IF EXISTS idx_ai_screenings_created_at');
	await client.query('DROP INDEX IF EXISTS idx_ai_screenings_fit_score');
	await client.query('DROP INDEX IF EXISTS idx_ai_screenings_job_candidate');
	await client.query('DROP INDEX IF EXISTS idx_ai_screenings_candidate_id');
	await client.query('DROP INDEX IF EXISTS idx_ai_screenings_job_id');
	await client.query('DROP TABLE IF EXISTS ai_screening_human_reviews');
	await client.query('DROP TABLE IF EXISTS ai_screening_audit_logs');
	await client.query('DROP TABLE IF EXISTS ai_screenings');
	console.log('[migration 076] AI screener results schema dropped');
};
