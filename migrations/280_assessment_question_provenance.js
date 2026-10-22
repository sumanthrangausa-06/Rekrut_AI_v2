// =============================================================================
// Migration 280: assessment_questions provenance/topic columns +
// assessment_sessions configuration snapshot + backfill + C0 curation pass
// (issue #1652, #1603 Phase C story C0)
// =============================================================================
//
// Design: docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/
// architecture-assessments-phase-c.md §3.4, §3.6, §6 steps 1–2, §7 rule 6.
//
// EXPAND-ONLY: new nullable columns, two NOT NULL columns whose DEFAULTs are
// the honest provenance values for pre-existing rows ('legacy' / 'pending',
// §3.4), and new indexes. No existing column is renamed, retyped, or dropped;
// no existing value is rewritten except the §6 backfill of the NEW columns.
//
// Backfill (§6 step 2), idempotent by construction:
//   - topic_id: joined from assessment_topics.legacy_skill_name on
//     LOWER(skill_category) = LOWER(legacy_skill_name) — unambiguous by
//     migration 279's partial unique index. Runs only WHERE topic_id IS
//     NULL. Rows matching no legacy name stay NULL and are reported by
//     scripts/audit-assessment-coverage.js — never guessed into a topic.
//   - format: derived from question_type (multiple_choice → mcq,
//     short_answer → short_answer, coding → coding). An unrecognised
//     question_type leaves format NULL (unclassified), never guessed.
//   - mcq_subtype / coding_template_id stay NULL for legacy rows (§3.4:
//     classified by a curation pass, not by guessing).
//
// Curation pass (§7 rule 6 + §9 C0): existing rows keep 'legacy'/'pending'
// — nothing already in the bank is silently promoted to supply. This pass
// approves exactly one auditable batch: the rows seeded by migration 006,
// which design §1.3 identifies as "the only curated seed source", matched on
// the FULL content tuple (identity + options + correct_answer +
// explanation — see the AMENDMENT below). They flip to source='curated',
// review_status='approved' (rule 6(d): curated rows are reviewed in their
// own PR — migration 006's seed was). The guard review_status='pending'
// makes a re-run flip 0 rows. Every other bank row stays pending for a
// later recorded review batch. The flipped count is logged here and
// reported on the issue.
//
// AMENDMENT (issue #1664, review H-1): the curation key was originally the
// identity tuple alone — (skill_category, difficulty_level, question_type,
// question_text). Any row sharing a seed row's identity was silently
// approved as scored truth, including a duplicate carrying a WRONG
// correct_answer (hazard proof on #1664: a typeof-null duplicate with
// correct_answer 'null' and an edited-answer React copy both flipped to
// approved). The key is now the full content tuple: identity PLUS options,
// correct_answer and explanation, compared NULL-safely (IS NOT DISTINCT
// FROM) so the two short_answer seeds — NULL options, NULL correct_answer —
// still match exactly. Seed content is copied character-for-character from
// migration 006 (lines 79–113 of 006_dynamic_assessments.js). A
// post-curation assertion verifies the curated+approved set EQUALS the set
// of full-content seed matches (no strays, none unflipped) and throws
// otherwise, so migrate.js rolls the whole migration back rather than
// record a poisoned approval. Companion migration 282 demotes any
// already-approved row on databases where the loose key ran before this
// amendment.
//
// Post-state assertion (268/270 precedent): verifies the new columns exist
// with the expected type families, so a divergent pre-existing shape fails
// LOUD inside migrate.js's per-file transaction instead of recording
// success over the wrong shape. Fix round 1 (review F1): the assertion ALSO
// verifies the CHECK vocabularies of the six CHECK-constrained columns —
// ADD COLUMN IF NOT EXISTS silently accepts a pre-existing column whose
// CHECK carries a divergent (or missing) vocabulary, and existence/type
// alone cannot see that.
//
// down(): drops the added columns — a contraction, recorded per the
// 274/278 convention; NOT part of this story's dev scope (design §6 step 5
// gates any contract step on separate Sumanth approval).
// =============================================================================

// ── Migration 006 seed content (#1664): copied character-for-character ────
// from migrations/006_dynamic_assessments.js (the seed INSERT). The two
// short_answer rows have NULL options and NULL correct_answer by design.
// Migrations are standalone files: migration 282 carries its own copy of
// this list (keep the two in sync) rather than importing shared state.
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
// Full-content match (#1664): identity tuple PLUS options / correct_answer /
// explanation, all NULL-safe. `alias` is the assessment_questions alias.
function seedFullMatchSql(alias) {
	return `EXISTS (
        SELECT 1 FROM (VALUES ${SEED_006_VALUES_SQL}) AS v(skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation)
        WHERE v.skill_category = ${alias}.skill_category
          AND v.difficulty_level = ${alias}.difficulty_level
          AND v.question_type = ${alias}.question_type
          AND v.question_text = ${alias}.question_text
          AND v.options IS NOT DISTINCT FROM ${alias}.options
          AND v.correct_answer IS NOT DISTINCT FROM ${alias}.correct_answer
          AND v.explanation IS NOT DISTINCT FROM ${alias}.explanation
      )`;
}
module.exports = {
	name: '280_assessment_question_provenance',
	up: async (client) => {
		// ── §3.4: assessment_questions — extended, not replaced ───────────
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS topic_id INT REFERENCES assessment_topics(id) ON DELETE SET NULL
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS format VARCHAR(20)
        CHECK (format IN ('mcq','short_answer','coding'))
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS mcq_subtype VARCHAR(20)
        CHECK (mcq_subtype IN ('concept','output_prediction','debugging','theory'))
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS coding_template_id INT REFERENCES coding_templates(id) ON DELETE SET NULL
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'legacy'
        CHECK (source IN ('seed','curated','ai_offline','ai_live','legacy'))
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('approved','pending','rejected'))
    `);

		// ── §3.6: assessment_sessions — configuration snapshot ────────────
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS subject_id INT REFERENCES assessment_subjects(id) ON DELETE SET NULL
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS topic_id INT REFERENCES assessment_topics(id) ON DELETE SET NULL
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS set_id INT REFERENCES assessment_sets(id) ON DELETE SET NULL
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS format VARCHAR(20)
        CHECK (format IN ('mcq','short_answer','mixed','coding'))
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS difficulty_band VARCHAR(10)
        CHECK (difficulty_band IN ('easy','medium','hard'))
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD COLUMN IF NOT EXISTS total_questions INT
    `);

		// ── §6 step 1 indexes ─────────────────────────────────────────────
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_questions_topic_format_diff
        ON assessment_questions(topic_id, format, difficulty_level)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_questions_coding_template
        ON assessment_questions(coding_template_id)
        WHERE coding_template_id IS NOT NULL
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_sessions_topic
        ON assessment_sessions(topic_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_sessions_subject
        ON assessment_sessions(subject_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_sessions_set
        ON assessment_sessions(set_id)
        WHERE set_id IS NOT NULL
    `);

		// ── §6 step 2 backfill (idempotent: NULL-guarded) ─────────────────
		const topicBackfill = await client.query(`
      UPDATE assessment_questions q
      SET topic_id = t.id
      FROM assessment_topics t
      WHERE q.topic_id IS NULL
        AND t.legacy_skill_name IS NOT NULL
        AND LOWER(q.skill_category) = LOWER(t.legacy_skill_name)
    `);
		console.log(
			`Migration 280: backfilled topic_id on ${topicBackfill.rowCount} assessment_questions rows`,
		);

		const formatBackfill = await client.query(`
      UPDATE assessment_questions
      SET format = CASE question_type
        WHEN 'multiple_choice' THEN 'mcq'
        WHEN 'short_answer' THEN 'short_answer'
        WHEN 'coding' THEN 'coding'
      END
      WHERE format IS NULL
        AND question_type IN ('multiple_choice','short_answer','coding')
    `);
		console.log(
			`Migration 280: backfilled format on ${formatBackfill.rowCount} assessment_questions rows`,
		);

		// ── Curation pass (§7 rule 6): approve migration 006's seed batch ─
		// #1664: the match is the FULL content tuple (identity + options +
		// correct_answer + explanation, NULL-safe), never identity alone —
		// a same-identity duplicate with a wrong correct_answer must stay
		// pending, not become approved scored truth.
		const curation = await client.query(
			`
      UPDATE assessment_questions q
      SET source = 'curated', review_status = 'approved'
      WHERE q.review_status = 'pending'
        AND ${seedFullMatchSql('q')}
    `,
			SEED_006_PARAMS,
		);
		console.log(
			`Migration 280: curation pass approved ${curation.rowCount} existing bank rows (migration 006 curated seed batch)`,
		);

		// ── Curation-integrity assertion (#1664) ──────────────────────────
		// After the flip, the curated+approved set must EQUAL the set of
		// full-content seed matches present in the table: no approved row
		// whose content diverged from the seed (stray), and no genuine seed
		// row left unapproved (unflipped). Any mismatch throws, so
		// migrate.js rolls the whole migration back instead of recording
		// success over a poisoned approval.
		const strayRes = await client.query(
			`
      SELECT COUNT(*)::int AS n FROM assessment_questions q
      WHERE q.source = 'curated' AND q.review_status = 'approved'
        AND NOT ${seedFullMatchSql('q')}
    `,
			SEED_006_PARAMS,
		);
		const unflippedRes = await client.query(
			`
      SELECT COUNT(*)::int AS n FROM assessment_questions q
      WHERE ${seedFullMatchSql('q')}
        AND NOT (q.source = 'curated' AND q.review_status = 'approved')
    `,
			SEED_006_PARAMS,
		);
		const approvedRes = await client.query(`
      SELECT COUNT(*)::int AS n FROM assessment_questions
      WHERE source = 'curated' AND review_status = 'approved'
    `);
		if (strayRes.rows[0].n !== 0 || unflippedRes.rows[0].n !== 0) {
			throw new Error(
				`280_assessment_question_provenance curation-integrity assertion failed (#1664): ` +
					`${strayRes.rows[0].n} curated+approved row(s) do not full-match the migration 006 seed content; ` +
					`${unflippedRes.rows[0].n} full-content seed match(es) are not curated+approved`,
			);
		}
		console.log(
			`Migration 280: curation-integrity assertion passed — curated+approved set (${approvedRes.rows[0].n} rows) equals the full-content seed matches`,
		);

		// ── Post-state assertion (268/270 precedent) ──────────────────────
		await client.query(`
      DO $$
      DECLARE
        bad TEXT;
      BEGIN
        SELECT string_agg(missing, ', ') INTO bad FROM (
          SELECT 'assessment_questions.topic_id:integer' AS missing WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='topic_id' AND data_type='integer')
          UNION ALL SELECT 'assessment_questions.format:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='format' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_questions.mcq_subtype:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='mcq_subtype' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_questions.coding_template_id:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='coding_template_id' AND data_type='integer')
          UNION ALL SELECT 'assessment_questions.source:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='source' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_questions.review_status:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_questions' AND column_name='review_status' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_sessions.subject_id:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='subject_id' AND data_type='integer')
          UNION ALL SELECT 'assessment_sessions.topic_id:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='topic_id' AND data_type='integer')
          UNION ALL SELECT 'assessment_sessions.set_id:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='set_id' AND data_type='integer')
          UNION ALL SELECT 'assessment_sessions.format:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='format' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_sessions.difficulty_band:varchar' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='difficulty_band' AND data_type IN ('character varying','text'))
          UNION ALL SELECT 'assessment_sessions.total_questions:integer' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='assessment_sessions' AND column_name='total_questions' AND data_type='integer')
        ) s;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION '280_assessment_question_provenance post-state: missing/mistyped columns: %', bad;
        END IF;
      END
      $$;
    `);

		// ── Post-state assertion, part 2 (fix round 1, review F1): CHECK ──
		// vocabularies. For each CHECK-constrained column, collect the value
		// literals of every CHECK constraint on the table whose definition
		// references that column, and require the sorted set to EQUAL the
		// expected vocabulary — a pre-existing column with a divergent,
		// wider, narrower, or missing CHECK fails LOUD here and rolls the
		// whole migration back.
		await client.query(`
      DO $$
      DECLARE
        spec RECORD;
        actual TEXT;
        bad TEXT := '';
      BEGIN
        FOR spec IN
          SELECT * FROM (VALUES
            ('assessment_questions', 'format',         'coding,mcq,short_answer'),
            ('assessment_questions', 'mcq_subtype',    'concept,debugging,output_prediction,theory'),
            ('assessment_questions', 'source',         'ai_live,ai_offline,curated,legacy,seed'),
            ('assessment_questions', 'review_status',  'approved,pending,rejected'),
            ('assessment_sessions',  'format',         'coding,mcq,mixed,short_answer'),
            ('assessment_sessions',  'difficulty_band','easy,hard,medium')
          ) AS v(tbl, col, expected)
        LOOP
          SELECT string_agg(lit, ',' ORDER BY lit) INTO actual FROM (
            SELECT DISTINCT (m)[1] AS lit
            FROM (
              SELECT regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE c.contype = 'c'
                AND n.nspname = 'public'
                AND t.relname = spec.tbl
                AND pg_get_constraintdef(c.oid) ~ ('\\m' || spec.col || '\\M')
            ) d
          ) s;
          IF actual IS DISTINCT FROM spec.expected THEN
            bad := bad || format(' %s.%s expected CHECK vocab [%s], found [%s];',
              spec.tbl, spec.col, spec.expected, COALESCE(actual, 'none'));
          END IF;
        END LOOP;
        IF bad <> '' THEN
          RAISE EXCEPTION '280_assessment_question_provenance post-state: divergent CHECK vocabularies:%', bad;
        END IF;
      END
      $$;
    `);

		console.log('Migration 280: provenance/topic columns added, backfill + curation complete');
	},
	down: async (client) => {
		await client.query(`
      ALTER TABLE assessment_sessions
      DROP COLUMN IF EXISTS total_questions,
      DROP COLUMN IF EXISTS difficulty_band,
      DROP COLUMN IF EXISTS format,
      DROP COLUMN IF EXISTS set_id,
      DROP COLUMN IF EXISTS topic_id,
      DROP COLUMN IF EXISTS subject_id
    `);
		await client.query(`
      ALTER TABLE assessment_questions
      DROP COLUMN IF EXISTS review_status,
      DROP COLUMN IF EXISTS source,
      DROP COLUMN IF EXISTS coding_template_id,
      DROP COLUMN IF EXISTS mcq_subtype,
      DROP COLUMN IF EXISTS format,
      DROP COLUMN IF EXISTS topic_id
    `);
	},
};
