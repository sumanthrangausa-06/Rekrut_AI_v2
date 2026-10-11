// =============================================================================
// Migration 247: interview_sessions indexes + type constraint (S-001, Issue #640)
// =============================================================================
//
// Addresses database-reviewer findings from S-001 specialist review (2026-10-10):
//   - Missing index on application_id (queried by candidate.js, interview-sessions.js)
//   - Missing index on company_id (recruiter dashboard queries)
//   - No CHECK constraint on type (prevents storing non-canonical type strings)
//
// Deferred (not in this migration):
//   - TIMESTAMP → TIMESTAMPTZ conversion (needs data semantics verification)
//   - scheduled_interviews backfill (new story for Lead)
// =============================================================================

module.exports = {
	name: '247_interview_sessions_indexes',
	up: async (client) => {
		// Index for candidate-side lookups by application
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_application
        ON interview_sessions(application_id)
    `);

		// Index for recruiter-side company-scoped queries
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_company
        ON interview_sessions(company_id)
    `);

		// Constrain type to the 4 canonical DB forms (underscore convention)
		// Prevents typos or hyphenated forms from landing in the DB.
		await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_interview_sessions_type'
        ) THEN
          ALTER TABLE interview_sessions
            ADD CONSTRAINT chk_interview_sessions_type
            CHECK (type IN ('screening', 'ai_interview', 'practice', 'human'));
        END IF;
      END
      $$;
    `);
	},

	down: async (client) => {
		await client.query(`ALTER TABLE interview_sessions DROP CONSTRAINT IF EXISTS chk_interview_sessions_type`);
		await client.query(`DROP INDEX IF EXISTS idx_interview_sessions_company`);
		await client.query(`DROP INDEX IF EXISTS idx_interview_sessions_application`);
	},
};
