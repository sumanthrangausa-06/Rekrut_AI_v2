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
// Specialist review (ecc/database-reviewer, STOP 1 on #1336 — corrected
// attribution: an early summary misstated two of these positions; the
// specialist's delivered verdict, adopted here, is):
//   - score INTEGER: every sibling score column is INTEGER
//     (skill_assessments.score, candidate_skills.verified_score,
//     score_appeals); no evidenced writer produces fractional scores;
//     and node-pg returns NUMERIC as a string, which would corrupt the
//     compliance SELECT * export ("85.00" instead of 85). No range
//     CHECK — the scale is unproven (cf. skill_assessments.max_score).
//   - skill_name NOT NULL: it is the row's identity; the reader
//     subquery filters score IS NOT NULL but not skill_name, so a
//     nullable column could emit {"skill": null, …} into the screener
//     prompt. A general/unnamed result belongs in omni_scores, not here.
//   - No updated_at (append-only rows; nothing reads or writes one), no
//     skill_id/session_id FK, max_score or passed (nothing references
//     them — a future writer story can add what it actually needs).
//   - user_id ON DELETE CASCADE: matches skill_assessments (migration
//     004) and the platform convention for user-owned result rows; the
//     retention purge and erasure paths assume user-attributable rows.
//     (Cascade does not fire on soft-delete; the missing erasureService
//     family for this table is a separate follow-up, not this story.)
//   - Post-state assertion (below): per the 268/269 precedent, verify
//     the required columns exist with the expected type families so a
//     wrong-shaped pre-existing table fails LOUD here instead of
//     silently no-oping and returning later as a fresh-install 500.
// Indexes: user_id serves both reader subqueries, the compliance export
// and the legal-hold predicate; created_at serves the retention purge's
// range predicate. CREATE TABLE IF NOT EXISTS makes this a no-op on DBs
// where the table was created out-of-band (live), while fresh installs
// gain the table. Additive only — no existing structure changes.
//
// Live-shape honesty (independent review + STOP 1 specialist, PR for
// #1336): on a DB where the table pre-exists out-of-band, this migration
// does NOT reconcile a divergent live shape — no in-repo evidence
// documents the live shape, and altering a live table is outside this
// story's additive boundary; reconciliation, if ever evidenced, is a
// separate gated story. Instead, the post-state assertion below fails
// loud on divergence, at the promotion gate, where a human decides.
// The index creations are column-guarded so that the assertion — with
// its precise message — is what raises, not a raw index error.
// =============================================================================

module.exports = {
	name: '270_assessment_results',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_name VARCHAR(255) NOT NULL,
        score INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

		// Column-guarded index creation (see header): never let an index
		// on a hypothetically-absent column abort the migration chain.
		await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'assessment_results' AND column_name = 'user_id') THEN
          CREATE INDEX IF NOT EXISTS idx_assessment_results_user_id
            ON assessment_results(user_id);
        ELSE
          RAISE WARNING '270_assessment_results: assessment_results.user_id missing — user_id index skipped';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'assessment_results' AND column_name = 'created_at') THEN
          CREATE INDEX IF NOT EXISTS idx_assessment_results_created_at
            ON assessment_results(created_at);
        ELSE
          RAISE WARNING '270_assessment_results: assessment_results.created_at missing — created_at index skipped';
        END IF;
      END
      $$;
    `);

		// Post-state assertion (268/269 precedent): the required columns
		// must exist with the expected type families — on a fresh install
		// this verifies our own CREATE; on a DB with a pre-existing
		// out-of-band table it fails loud on shape drift instead of
		// recording success over the wrong shape. migrate.js wraps up()
		// + the _migrations insert in one transaction, so a RAISE rolls
		// back and records nothing.
		await client.query(`
      DO $$
      DECLARE
        bad TEXT;
      BEGIN
        SELECT string_agg(missing, ', ') INTO bad FROM (
          SELECT 'id:integer' AS missing WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='id' AND data_type='integer')
          UNION ALL SELECT 'user_id:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='user_id' AND data_type='integer')
          UNION ALL SELECT 'skill_name:character varying' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='skill_name' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'score:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='score' AND data_type='integer')
          UNION ALL SELECT 'created_at:timestamp' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='created_at' AND data_type LIKE 'timestamp%')
        ) s;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION '270_assessment_results post-state: missing/mistyped columns: %', bad;
        END IF;
      END
      $$;
    `);

		console.log('Migration 270: assessment_results table created (or already present)');
	},
};
