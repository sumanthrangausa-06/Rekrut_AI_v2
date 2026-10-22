// =============================================================================
// Migration 282: curation content integrity — demote content-diverged rows
// that the pre-amendment migration 280 curation key approved (issue #1664)
// =============================================================================
//
// Defect (review H-1 on #1652, filed as #1664): migration 280's curation pass
// originally matched migration 006's seed batch on the IDENTITY tuple alone —
// (skill_category, difficulty_level, question_type, question_text). Any bank
// row sharing a seed row's identity flipped to source='curated',
// review_status='approved' — including a duplicate whose correct_answer was
// wrong (hazard proof on #1664: a typeof-null duplicate with correct_answer
// 'null', and a React seed copy with an edited answer, both approved as
// scored truth). Migration 280 is amended in the same change to key on the
// FULL content tuple, but databases where the loose 280 already ran (dev,
// staging) keep the poisoned approvals — this migration removes them.
//
// What this migration does (data-only, no schema change — expand-phase
// compatible, nothing contracted):
//   1. DEMOTE: every row with source='curated' AND review_status='approved'
//      whose identity tuple matches one of the 6 seed tuples but whose
//      (options, correct_answer, explanation) do NOT all NULL-safe-match
//      that seed's content is set back to source='legacy',
//      review_status='pending' — the honest pre-curation provenance values
//      (280's defaults). The demoted count is logged.
//   2. RE-ASSERT: after demotion, the curated+approved set must EQUAL the
//      set of full-content seed matches present in the table (no strays,
//      none unflipped). A mismatch RAISES (throws) so migrate.js rolls
//      back instead of recording success over a still-poisoned bank.
//
// Idempotent: on a clean bank (fresh install, where the amended 280 ran)
// the demotion matches 0 rows and the assertion passes; re-running this
// migration's up() demotes 0 and passes again.
//
// Seed content is copied character-for-character from migration 006 (the
// seed INSERT in 006_dynamic_assessments.js) — the same list migration 280
// carries. Migrations are standalone files, so the list is duplicated here
// deliberately rather than imported (keep the two copies in sync).
//
// down(): NO-OP, deliberately. Reversing the demotion would re-approve the
// very rows this migration proved content-diverged — re-approving poisoned
// rows is never a safe rollback. Recorded here per the house convention
// that a contraction/irreversible step is documented, not hidden: if the
// demotion itself were ever judged wrong, the fix is a forward curation
// pass with a recorded review batch, not a down().
// =============================================================================

// ── Migration 006 seed content (#1664): see migration 280 for the source ──
const SEED_006_CONTENT = [
	{
		skill: 'JavaScript', difficulty: 2, type: 'multiple_choice',
		text: 'What is the output of: console.log(typeof null)?',
		options: ['object', 'null', 'undefined', 'number'],
		correct: 'object',
		explanation: 'typeof null returns "object" - this is a known JavaScript quirk/bug that has been preserved for backwards compatibility.',
	},
	{
		skill: 'JavaScript', difficulty: 3, type: 'multiple_choice',
		text: 'What will this code output: console.log(1 + "2" + 3)?',
		options: ['123', '6', '33', 'Error'],
		correct: '123',
		explanation: 'JavaScript type coercion: 1 + "2" becomes "12" (string), then "12" + 3 becomes "123".',
	},
	{
		skill: 'React', difficulty: 2, type: 'multiple_choice',
		text: 'Which hook is used to perform side effects in React?',
		options: ['useEffect', 'useState', 'useMemo', 'useCallback'],
		correct: 'useEffect',
		explanation: 'useEffect is the React hook for handling side effects like data fetching, subscriptions, or DOM manipulation.',
	},
	{
		skill: 'Python', difficulty: 2, type: 'multiple_choice',
		text: 'What is the correct way to create a list in Python?',
		options: ['[1, 2, 3]', '{1, 2, 3}', '(1, 2, 3)', 'list(1, 2, 3)'],
		correct: '[1, 2, 3]',
		explanation: 'Square brackets [] define a list in Python. Curly braces {} create a set, parentheses () create a tuple.',
	},
	{
		skill: 'Communication', difficulty: 1, type: 'short_answer',
		text: 'Describe a time when you had to explain a complex technical concept to a non-technical stakeholder. How did you approach it?',
		options: null,
		correct: null,
		explanation: 'Look for clarity, patience, use of analogies, checking for understanding, and successful outcome.',
	},
	{
		skill: 'Problem Solving', difficulty: 2, type: 'short_answer',
		text: 'You encounter a critical bug in production that affects 20% of users. Walk me through your debugging process.',
		options: null,
		correct: null,
		explanation: 'Good answers include: gather data, reproduce, isolate, hypothesize, test, fix, verify, document.',
	},
];
const SEED_006_PARAMS = SEED_006_CONTENT.flatMap((s) => [
	s.skill,
	s.difficulty,
	s.type,
	s.text,
	s.options === null ? null : JSON.stringify(s.options),
	s.correct,
	s.explanation,
]);
const SEED_006_VALUES_SQL = SEED_006_CONTENT.map((_, i) => {
	const b = i * 7;
	return `($${b + 1}::text, $${b + 2}::int, $${b + 3}::text, $${b + 4}::text, $${b + 5}::jsonb, $${b + 6}::text, $${b + 7}::text)`;
}).join(', ');
const SEED_VALUES_FROM = `(VALUES ${SEED_006_VALUES_SQL}) AS v(skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation)`;
const SEED_IDENTITY_MATCH = `v.skill_category = q.skill_category
          AND v.difficulty_level = q.difficulty_level
          AND v.question_type = q.question_type
          AND v.question_text = q.question_text`;
const SEED_CONTENT_MATCH = `v.options IS NOT DISTINCT FROM q.options
          AND v.correct_answer IS NOT DISTINCT FROM q.correct_answer
          AND v.explanation IS NOT DISTINCT FROM q.explanation`;

module.exports = {
	name: '282_curation_content_integrity',
	up: async (client) => {
		// ── Step 1: demote content-diverged curated+approved rows ───────
		// Identity matches a seed tuple, but the content does NOT all
		// NULL-safe-match that same seed row (identity is unique per seed:
		// question_text differs across the 6), so the row is not the
		// reviewed seed content and cannot stay approved.
		const demote = await client.query(
			`
      UPDATE assessment_questions q
      SET source = 'legacy', review_status = 'pending'
      WHERE q.source = 'curated' AND q.review_status = 'approved'
        AND EXISTS (
          SELECT 1 FROM ${SEED_VALUES_FROM}
          WHERE ${SEED_IDENTITY_MATCH}
            AND NOT (${SEED_CONTENT_MATCH})
        )
    `,
			SEED_006_PARAMS,
		);
		console.log(
			`Migration 282: demoted ${demote.rowCount} content-diverged curated+approved row(s) to legacy/pending`,
		);

		// ── Step 2: re-assert curated+approved == full-content matches ──
		const strayRes = await client.query(
			`
      SELECT COUNT(*)::int AS n FROM assessment_questions q
      WHERE q.source = 'curated' AND q.review_status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM ${SEED_VALUES_FROM}
          WHERE ${SEED_IDENTITY_MATCH}
            AND ${SEED_CONTENT_MATCH}
        )
    `,
			SEED_006_PARAMS,
		);
		const unflippedRes = await client.query(
			`
      SELECT COUNT(*)::int AS n FROM assessment_questions q
      WHERE EXISTS (
          SELECT 1 FROM ${SEED_VALUES_FROM}
          WHERE ${SEED_IDENTITY_MATCH}
            AND ${SEED_CONTENT_MATCH}
        )
        AND NOT (q.source = 'curated' AND q.review_status = 'approved')
    `,
			SEED_006_PARAMS,
		);
		if (strayRes.rows[0].n !== 0 || unflippedRes.rows[0].n !== 0) {
			throw new Error(
				`282_curation_content_integrity post-state assertion failed (#1664): ` +
					`${strayRes.rows[0].n} curated+approved row(s) still do not full-match the migration 006 seed content; ` +
					`${unflippedRes.rows[0].n} full-content seed match(es) are not curated+approved`,
			);
		}

		console.log('Migration 282: curation content integrity verified — curated+approved set equals the full-content seed matches');
	},
	down: async () => {
		// Deliberate no-op (see header): reversing the demotion would
		// re-approve content-diverged rows. Nothing to undo.
		console.log('Migration 282: down() is a deliberate no-op — demoted rows stay demoted (see header)');
	},
};
