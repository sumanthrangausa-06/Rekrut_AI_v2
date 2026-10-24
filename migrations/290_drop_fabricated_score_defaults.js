// =============================================================================
// Migration 290: DROP DEFAULT on 28 fabricated score columns (#1280; #1270 rider)
// =============================================================================
//
// WHAT: removes the column DEFAULT from 28 score columns across 7 tables, so
// an INSERT that omits a score stores NULL (honest "no data") instead of a
// number nobody computed.
//
// WHY: Rekrut's no-fake-numbers standard — where no data exists, a surface
// shows "Insufficient data" / "N/A", never an invented score. These defaults
// did the opposite at the schema layer: a brand-new candidate row was born
// with OmniScore total 300 and peer_percentile 50 (the middle of the
// distribution, claimed with zero evidence), a brand-new company with Trust
// Score 500, and every assessment attempt with anti_cheat_score 100 — a
// perfect integrity score for an attempt nobody had analysed. The Oct 21
// #1280 audit found 27 such columns; this migration drops those plus the
// #1270 peer_percentile default, which Sumanth approved to ride with it.
//
// APPROVAL / GATE RECORD:
// - Sumanth approved the DROP DEFAULT fix on issue #1280, 2026-10-22
//   (comment 6352894607), with #1270's peer_percentile drop riding, as
//   presented. Existing-row heals were NOT part of that approval.
// - STOP 1 for this build: issue #1280 comment 6353005438.
//
// THE 28 COLUMNS (verified against the creating migrations in this tree):
//
// Group A — score totals and factors (#1280; migrations 001, 002, 030, 132):
//   omni_scores (001):        total_score DEFAULT 300,
//                             interview_score DEFAULT 0,
//                             technical_score DEFAULT 0,
//                             resume_score DEFAULT 0,
//                             behavior_score DEFAULT 0
//   role_scores (001):        score DEFAULT 300
//   mutual_matches (030):     candidate_score DEFAULT 300,
//                             company_score DEFAULT 500,
//                             mutual_fit_score DEFAULT 0
//   trust_scores (002):       total_score DEFAULT 500,
//                             verification_score DEFAULT 0,
//                             job_authenticity_score DEFAULT 0,
//                             hiring_ratio_score DEFAULT 0,
//                             feedback_score DEFAULT 0,
//                             behavior_score DEFAULT 0
//   trust_scores (132, v2):   employee_satisfaction_score DEFAULT 0,
//                             interview_experience_score DEFAULT 0,
//                             offer_acceptance_rate_score DEFAULT 0,
//                             time_to_hire_score DEFAULT 0,
//                             response_rate_score DEFAULT 0,
//                             salary_competitiveness_score DEFAULT 0,
//                             diversity_metrics_score DEFAULT 0,
//                             career_growth_score DEFAULT 0,
//                             data_sufficiency_score DEFAULT 0
//
// Group B — anti-cheat scores (#1280; migrations 006, 042, 074):
//   skill_assessments (006):       anti_cheat_score DEFAULT 100
//   job_assessment_attempts (042): anti_cheat_score DEFAULT 100
//   aptitude_test_attempts (074):  anti_cheat_score DEFAULT 100
//
// #1270 rider (migration 077):
//   omni_scores:              peer_percentile DEFAULT 50
//
// SCOPE LIMITS — read before reusing this pattern:
// - NO EXISTING ROWS ARE TOUCHED. DROP DEFAULT changes only what future
//   INSERTs that omit the column will store; it rewrites no data. Rows
//   already carrying fabricated values from these defaults are a separate,
//   unapproved data-heal gate — NOT included here (per the approval above).
// - DROP DEFAULT is not a column drop and not a table drop: every column,
//   its type, its CHECK constraints (e.g. aptitude_test_attempts'
//   anti_cheat_score range check) and all stored values survive unchanged.
// - Writers that compute a real score and supply it explicitly are
//   unaffected; only silent omission changes (fabricated value -> NULL),
//   which is the honest state readers already render as insufficient data.
//
// UP-ONLY, NO down(): restoring a fabricated default would re-fabricate
// scores, so there is deliberately no down(). DROP DEFAULT is itself
// idempotent — running up() twice leaves every default NULL — and the
// post-state assertion in up() proves it: it re-reads information_schema
// for all 28 (table, column) pairs and throws if any column is missing or
// any column_default IS NOT NULL, so the migration cannot record success
// over a schema that still fabricates.
// =============================================================================

const COLUMNS = [
	// Group A — omni_scores (001)
	['omni_scores', 'total_score'],
	['omni_scores', 'interview_score'],
	['omni_scores', 'technical_score'],
	['omni_scores', 'resume_score'],
	['omni_scores', 'behavior_score'],
	// Group A — role_scores (001)
	['role_scores', 'score'],
	// Group A — mutual_matches (030)
	['mutual_matches', 'candidate_score'],
	['mutual_matches', 'company_score'],
	['mutual_matches', 'mutual_fit_score'],
	// Group A — trust_scores (002 + 132)
	['trust_scores', 'total_score'],
	['trust_scores', 'verification_score'],
	['trust_scores', 'job_authenticity_score'],
	['trust_scores', 'hiring_ratio_score'],
	['trust_scores', 'feedback_score'],
	['trust_scores', 'behavior_score'],
	['trust_scores', 'employee_satisfaction_score'],
	['trust_scores', 'interview_experience_score'],
	['trust_scores', 'offer_acceptance_rate_score'],
	['trust_scores', 'time_to_hire_score'],
	['trust_scores', 'response_rate_score'],
	['trust_scores', 'salary_competitiveness_score'],
	['trust_scores', 'diversity_metrics_score'],
	['trust_scores', 'career_growth_score'],
	['trust_scores', 'data_sufficiency_score'],
	// Group B — anti-cheat (006, 042, 074)
	['skill_assessments', 'anti_cheat_score'],
	['job_assessment_attempts', 'anti_cheat_score'],
	['aptitude_test_attempts', 'anti_cheat_score'],
	// #1270 rider — omni_scores (077)
	['omni_scores', 'peer_percentile'],
];

module.exports = {
	name: '290_drop_fabricated_score_defaults',
	async up(client) {
		for (const [table, column] of COLUMNS) {
			await client.query(
				`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`,
			);
		}

		// Post-state assertion: all 28 columns exist and none carries a default.
		const values = COLUMNS.map(
			([t, c], i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
		).join(', ');
		const params = COLUMNS.flat();
		const check = await client.query(
			`SELECT p.t AS table_name, p.c AS column_name, i.column_default
			 FROM (VALUES ${values}) AS p(t, c)
			 LEFT JOIN information_schema.columns i
			   ON i.table_schema = 'public' AND i.table_name = p.t AND i.column_name = p.c`,
			params,
		);
		const bad = check.rows.filter(
			(r) => r.column_default !== null,
		);
		// A missing column also surfaces as column_default NULL via the LEFT
		// JOIN, so count the joined rows explicitly to rule that out.
		const found = await client.query(
			`SELECT COUNT(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND (table_name, column_name) IN (VALUES ${values})`,
			params,
		);
		if (found.rows[0].n !== COLUMNS.length || bad.length > 0) {
			throw new Error(
				`Migration 290 post-state assertion failed: found ${found.rows[0].n}/${COLUMNS.length} columns; ` +
					`columns still carrying a DEFAULT: ${bad.map((r) => `${r.table_name}.${r.column_name}=${r.column_default}`).join(', ') || 'none'}`,
			);
		}

		console.log(
			`Migration 290: DROP DEFAULT applied to all ${COLUMNS.length} fabricated score columns (#1280, #1270 rider); post-state verified — every column_default is NULL, no existing rows touched`,
		);
	},
};
