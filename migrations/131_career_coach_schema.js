// Migration: AI Career Coach Schema (Issue #121)
// Tables for career coaching sessions, recommendations, skill gaps, learning paths,
// company research briefs, application optimizations, and salary practice sessions.

module.exports = {
	name: 'career_coach_schema',
	up: async (client) => {
		// ── Career coach sessions ──────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS career_coach_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_type VARCHAR(50) NOT NULL,
          -- 'career_path', 'skill_gap', 'learning_path', 'company_research',
          -- 'application_optimize', 'salary_practice'
        status VARCHAR(20) DEFAULT 'active',
        input_data JSONB DEFAULT '{}',
        result_data JSONB DEFAULT '{}',
        ai_model VARCHAR(50),
        tokens_used INTEGER DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Career recommendations (career paths) ──────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS career_recommendations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        current_role VARCHAR(255),
        target_role VARCHAR(255),
        pathway JSONB DEFAULT '[]',
          -- [{ step, role, timeframe, required_skills, avg_salary, confidence }]
        market_data JSONB DEFAULT '{}',
          -- { demand_trend, salary_range, top_hiring_companies }
        grounding_jobs JSONB DEFAULT '[]',
          -- [{ job_id, title, company, match_score }]
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Skill gap analyses ────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS skill_gap_analyses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        target_role VARCHAR(255),
        current_skills JSONB DEFAULT '[]',
        required_skills JSONB DEFAULT '[]',
        gap_skills JSONB DEFAULT '[]',
          -- [{ skill, level_required, level_current, gap, priority }]
        qualifying_jobs JSONB DEFAULT '[]',
          -- [{ job_id, title, company, location, salary_range, missing_skills }]
        action_plan JSONB DEFAULT '[]',
          -- [{ skill, resources, estimated_hours, priority }]
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Learning paths ────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS learning_paths (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        target_role VARCHAR(255),
        path_name VARCHAR(255),
        steps JSONB DEFAULT '[]',
          -- [{ order, title, type, resource_url, estimated_hours, skill_tags }]
        total_estimated_hours INTEGER DEFAULT 0,
        progress_percent INTEGER DEFAULT 0,
        completed_steps JSONB DEFAULT '[]',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Company research briefs ───────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS company_research_briefs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        company_name VARCHAR(255) NOT NULL,
        brief_json JSONB DEFAULT '{}',
          -- {
          --   summary, culture, interview_process, salary_benchmarks,
          --   glassdoor_highlights, trustscore, recent_news, red_flags,
          --   recommended_questions
          -- }
        trust_score_at_time INTEGER,
        job_openings_count INTEGER DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Application optimizations ─────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS application_optimizations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        job_title VARCHAR(255),
        company_name VARCHAR(255),
        original_cover_letter TEXT,
        optimized_cover_letter TEXT,
        original_answers JSONB DEFAULT '[]',
        optimized_answers JSONB DEFAULT '[]',
        diff_highlights JSONB DEFAULT '[]',
          -- [{ type: 'add'|'remove'|'keep', text, reason }]
        score_before INTEGER,
        score_after INTEGER,
        feedback JSONB DEFAULT '{}',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Salary practice sessions ──────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS salary_practice_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES career_coach_sessions(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        job_title VARCHAR(255),
        company_name VARCHAR(255),
        offered_salary INTEGER,
        target_salary INTEGER,
        market_benchmark INTEGER,
        conversation JSONB DEFAULT '[]',
          -- [{ role: 'user'|'ai', text, timestamp }]
        ai_feedback JSONB DEFAULT '{}',
          -- { overall_score, strengths, weaknesses, tactics_used, suggested_counter }
        completed BOOLEAN DEFAULT false,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);

		// ── Indexes ───────────────────────────────────────────
		await client.query(`CREATE INDEX IF NOT EXISTS idx_career_coach_sessions_user ON career_coach_sessions(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_career_coach_sessions_type ON career_coach_sessions(session_type)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_career_recommendations_user ON career_recommendations(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_skill_gap_user ON skill_gap_analyses(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_learning_paths_user ON learning_paths(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_company_briefs_user ON company_research_briefs(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_company_briefs_company ON company_research_briefs(company_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_app_optimizations_user ON application_optimizations(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_salary_practice_user ON salary_practice_sessions(user_id)`);

		console.log('[migration] career_coach_schema tables created');
	},
};
