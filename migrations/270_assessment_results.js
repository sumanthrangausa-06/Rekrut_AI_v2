// =============================================================================
// Migration 270: create assessment_results — the table no migration created (#1336)
// =============================================================================
//
// Root cause (#1336, Quinn E2E-on-dev at fc7c0ccf8): getCandidateFullProfile
// (routes/ai-screener.js) and the twin query in routes/screening.js read
// assessment_results, but no migration ever created it — grep of
// migrations/ + migrate.js found no CREATE TABLE. The table presumably
// exists on the shared live DB from an out-of-band creation, so only fresh
// installs / rebuilds break: POST /api/jobs/:id/screen/:candidateId 500s
// with: relation "assessment_results" does not exist.
//
// Shape derived from EVERY code reference (STOP 1, issue #1336):
//   - routes/ai-screener.js:132 + routes/screening.js:54:
//       json_build_object('skill', skill_name, 'score', score)
//       … WHERE user_id = u.id AND score IS NOT NULL
//   - routes/compliance.js:75: SELECT * WHERE user_id = $1 (GDPR export)
//   - services/euComplianceService.js (assessment_results purge branch):
//       COUNT/DELETE WHERE created_at < $1 AND hold predicate on user_id
//   - migrations/013: retention registry row only (1825 days) — no DDL.
//   - Writers: NONE. No INSERT/UPDATE into assessment_results exists in
//     the codebase today; the table is read-only legacy-shaped data.
// Specialist review (ecc/database-reviewer, STOP 1 on #1336):
//   - score NUMERIC(5,2): readers render it as a percentage and fractional
//     scores occur (88.5) — INTEGER would silently truncate them.
//   - skill_name NULLABLE: with no writer in the codebase, NOT NULL would
//     be an invented constraint that could reject a legitimate future
//     writer (e.g. a general/non-skill result row).
//   - No updated_at (append-only rows; nothing reads or writes one), no
//     skill_id/session_id FK, max_score or passed (nothing references
//     them — a future writer story can add what it actually needs).
//   - user_id ON DELETE CASCADE: matches skill_assessments (migration
//     004) and the platform convention for user-owned result rows; the
//     retention purge and erasure paths assume user-attributable rows.
// Indexes: user_id serves both reader subqueries, the compliance export
// and the legal-hold predicate; created_at serves the retention purge's
// range predicate. CREATE TABLE/INDEX IF NOT EXISTS makes this a no-op
// on DBs where the table was created out-of-band (live), while fresh
// installs gain the table. Additive only — no existing structure changes.
// =============================================================================

module.exports = {
	name: '270_assessment_results',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_name VARCHAR(255),
        score NUMERIC(5,2),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_results_user_id
        ON assessment_results(user_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_results_created_at
        ON assessment_results(created_at)
    `);

		console.log('Migration 270: assessment_results table created (or already present)');
	},
};
