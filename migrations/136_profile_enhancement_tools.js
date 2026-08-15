// Migration: Profile Enhancement Tools Schema (Issue #26)
// Tables for CV uploads, LinkedIn profiles, career diagnoses, and tool progress tracking.

module.exports = {
	name: 'profile_enhancement_tools',
	up: async (client) => {
		// ── CV Uploads ─────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS cv_uploads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_url TEXT,
        file_name VARCHAR(255),
        parsed_text TEXT,
        analysis_result JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'uploaded'
          CHECK (status IN ('uploaded', 'parsing', 'analyzed', 'failed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

		// ── LinkedIn Profiles ──────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS linkedin_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        linkedin_url TEXT,
        headline VARCHAR(255),
        summary TEXT,
        skills JSONB DEFAULT '[]',
        optimization_tips JSONB DEFAULT '[]',
        connected_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

		// ── Career Diagnoses ───────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS career_diagnoses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_answers JSONB DEFAULT '[]',
        career_path VARCHAR(255),
        strengths JSONB DEFAULT '[]',
        recommendations JSONB DEFAULT '[]',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

		// ── Profile Tool Progress ──────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS profile_tool_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_type VARCHAR(50) NOT NULL
          CHECK (tool_type IN ('cv_review', 'linkedin', 'career_diagnosis', 'coaching')),
        status VARCHAR(50) DEFAULT 'not_started'
          CHECK (status IN ('not_started', 'in_progress', 'completed')),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, tool_type)
      )
    `);

		// ── Indexes ───────────────────────────────────────────
		await client.query(`CREATE INDEX IF NOT EXISTS idx_cv_uploads_user ON cv_uploads(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_cv_uploads_status ON cv_uploads(status)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_user ON linkedin_profiles(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_career_diagnoses_user ON career_diagnoses(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_profile_tool_progress_user ON profile_tool_progress(user_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_profile_tool_progress_type ON profile_tool_progress(tool_type)`);

		console.log('[migration] profile_enhancement_tools tables created');
	},
};
