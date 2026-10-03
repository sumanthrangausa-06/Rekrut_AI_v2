// =============================================================================
// Migration: Multi-Interviewer Panel with Scorecards and Shared Notes (Issue #125)
// =============================================================================
// Creates tables for interview panels, panel members, shared/private notes,
// scorecards, scorecard items, and per-job scorecard criteria.
//
// Tables:
//   - interview_panels         : Panel associated with job + interview session
//   - panel_members            : Interviewers on a panel with roles
//   - panel_notes              : Shared and private notes
//   - scorecards               : Structured evaluation per interviewer
//   - scorecard_items          : Per-criterion rating and comment
//   - panel_scorecard_criteria : Criteria defined per job
//
// =============================================================================

module.exports = {
	name: '125_interview_panels',
	up: async (client) => {
		// ────────────────────────────────────────────────────────────────────
		// interview_panels — Panel associated with a job and interview session
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_panels (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        interview_session_id INTEGER REFERENCES scheduled_interviews(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_panels_job ON interview_panels(job_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_panels_session ON interview_panels(interview_session_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_panels_status ON interview_panels(status)
    `);

		// ────────────────────────────────────────────────────────────────────
		// panel_members — Interviewers on a panel with roles
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS panel_members (
        id SERIAL PRIMARY KEY,
        panel_id INTEGER NOT NULL REFERENCES interview_panels(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(30) NOT NULL DEFAULT 'panelist' CHECK (role IN ('lead', 'panelist', 'hiring_manager', 'observer')),
        status VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined', 'declined')),
        invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        joined_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(panel_id, user_id)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_members_panel ON panel_members(panel_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_members_user ON panel_members(user_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_members_status ON panel_members(status)
    `);

		// ────────────────────────────────────────────────────────────────────
		// panel_notes — Shared and private notes
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS panel_notes (
        id SERIAL PRIMARY KEY,
        panel_id INTEGER NOT NULL REFERENCES interview_panels(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        visibility VARCHAR(20) NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_notes_panel ON panel_notes(panel_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_notes_author ON panel_notes(author_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_notes_visibility ON panel_notes(visibility)
    `);

		// ────────────────────────────────────────────────────────────────────
		// panel_scorecard_criteria — Criteria defined per job
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS panel_scorecard_criteria (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        criterion_name VARCHAR(100) NOT NULL,
        description TEXT,
        weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,
        required BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(job_id, criterion_name)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panel_scorecard_criteria_job ON panel_scorecard_criteria(job_id)
    `);

		// ────────────────────────────────────────────────────────────────────
		// scorecards — Structured evaluation per interviewer
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS scorecards (
        id SERIAL PRIMARY KEY,
        panel_id INTEGER NOT NULL REFERENCES interview_panels(id) ON DELETE CASCADE,
        interviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        overall_recommendation VARCHAR(30),
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
        submitted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(panel_id, interviewer_id)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scorecards_panel ON scorecards(panel_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scorecards_interviewer ON scorecards(interviewer_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scorecards_status ON scorecards(status)
    `);

		// ────────────────────────────────────────────────────────────────────
		// scorecard_items — Per-criterion rating and comment
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS scorecard_items (
        id SERIAL PRIMARY KEY,
        scorecard_id INTEGER NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
        criterion_name VARCHAR(100) NOT NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(scorecard_id, criterion_name)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scorecard_items_scorecard ON scorecard_items(scorecard_id)
    `);

		console.log('[migration] Interview panel tables created (Issue #125)');
	},
};
