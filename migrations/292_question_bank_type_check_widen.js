// =============================================================================
// Migration 292: widen chk_question_bank_type to the union of the two real
// question_type taxonomies (#1739)
// =============================================================================
//
// WHAT: drops chk_question_bank_type on question_bank and re-adds it with
// the widened value list:
//   'behavioral', 'technical', 'situational', 'competency', 'role_specific',
//   'text', 'select', 'yes_no', 'single_choice', 'multiple_choice',
//   'short_text', 'numeric'
//
// WHY: question_bank carries TWO different question_type taxonomies, and
// the CHECK only ever admitted one of them:
//
//   1. The AI taxonomy — the kind of interview question. The constraint's
//      source, migrations/p2_schema_hardening.sql:2979, admits only
//      ('behavioral','technical','situational','competency',
//      'role_specific'). Those are the values the AI writers use:
//      routes/interviews.js INSERTs into question_bank with a role and an
//      AI-taxonomy question_type. (Verified: no other migration creates
//      or alters this constraint — migrations/047_p2_schema_hardening.js,
//      the JS sibling of the .sql hardening file, has no question_bank
//      constraint entry; the CHECK comes only from the .sql file, which
//      migrate.js executes and records in _migrations. On a real
//      fresh-install DB the constraint is exactly chk_question_bank_type
//      with the 5-value definition above — 291-round fresh-check probe,
//      fresh-check-probe.log on #1739's build record.)
//
//   2. The screening answer-format taxonomy — HOW a candidate answers.
//      The recruiter writers save screening questions into the same
//      table and never use AI-taxonomy types:
//        - routes/memory.js    POST /question-bank (INSERT ~L173) —
//          question_type defaults to 'text'.
//        - routes/recruiter.js POST /question-bank (INSERT ~L3162) —
//          q.type || 'text'; its screening-template prompt documents
//          "type": "text|yes_no|select" (~L3114).
//      The client screening types agree: 'text' | 'yes_no' | 'select'
//      (client/src/pages/recruiter/job-form.tsx:59 and siblings), and
//      routes/questionnaire.js:224 validates screening questions against
//      ['single_choice','multiple_choice','short_text','yes_no','numeric'].
//
// Migration 291 made question_bank.role nullable so the recruiter writers
// stopped failing 23502 — but on any DB where p2_schema_hardening.sql has
// run (fresh install, staging, production) their INSERTs then fail 23514
// on chk_question_bank_type instead, because 'text' & friends are not in
// the CHECK. The 291-round fresh-check probe proved exactly that: same
// INSERT, role NULL accepted, CHECK rejected. Lead's ruling on #1739
// (comment 6358430497): widen the CHECK to the union of observed real
// values — this migration. Writers and client code are UNCHANGED; the
// schema was the defect, not the writers.
//
// SEMANTICS: the widened CHECK still guards the column — a value in
// neither taxonomy (e.g. 'nonsense_type') still fails 23514. Only values
// that real writers actually produce are admitted.
//
// SCOPE LIMITS:
// - NO EXISTING ROWS ARE TOUCHED. DROP/ADD CONSTRAINT re-validates the
//   table against the WIDER list; every existing row already satisfies
//   it (existing rows could only ever carry the original 5 values), so
//   the re-validation cannot fail on data and rewrites nothing.
// - The constraint keeps its original name, chk_question_bank_type, so
//   error surfaces and diagnostics are unchanged.
//
// IDEMPOTENCY: up() drops the constraint IF EXISTS and re-adds it, so it
// may run any number of times (including over a DB where the .sql
// hardening never landed the constraint). up() then re-reads the live
// constraint definition from pg_constraint and throws unless every
// widened value is present, so the migration cannot record success over
// a schema that still rejects recruiter saves.
//
// down(): restores the original 5-value CHECK — but ONLY when no rows
// carry the newly-admitted values. If such rows exist, narrowing would
// fail (and any forced variant would have to rewrite or delete real
// recruiter questions), so down() logs that fact and leaves the widened
// CHECK in place: a deliberate safe no-op, the same honesty precedent as
// migration 291's down(). migrate.js never calls down(); manual only.
// =============================================================================

const WIDENED_TYPES = [
	'behavioral',
	'technical',
	'situational',
	'competency',
	'role_specific',
	'text',
	'select',
	'yes_no',
	'single_choice',
	'multiple_choice',
	'short_text',
	'numeric',
];

const ORIGINAL_TYPES = [
	'behavioral',
	'technical',
	'situational',
	'competency',
	'role_specific',
];

const NEW_TYPES = WIDENED_TYPES.filter((t) => !ORIGINAL_TYPES.includes(t));

function checkSql(types) {
	return `CHECK (question_type IN (${types.map((t) => `'${t}'`).join(', ')}))`;
}

async function constraintDef(client) {
	const { rows } = await client.query(
		`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
		 WHERE conname = 'chk_question_bank_type'
		   AND conrelid = 'question_bank'::regclass`,
	);
	return rows.length === 1 ? rows[0].def : null;
}

module.exports = {
	name: '292_question_bank_type_check_widen',
	async up(client) {
		await client.query(
			'ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_question_bank_type;',
		);
		await client.query(
			`ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_type ${checkSql(WIDENED_TYPES)};`,
		);

		// Post-state assertion: the live definition admits every widened value.
		const def = await constraintDef(client);
		const missing = WIDENED_TYPES.filter((t) => !def || !def.includes(`'${t}'`));
		if (!def || missing.length > 0) {
			throw new Error(
				'Migration 292 post-state assertion failed: chk_question_bank_type ' +
					(!def
						? 'constraint not found after ADD'
						: `definition ${def} is missing values: ${missing.join(', ')}`),
			);
		}

		console.log(
			'Migration 292: chk_question_bank_type widened to the union of the AI taxonomy and the screening answer-format taxonomy (#1739) — recruiter screening questions (text/select/yes_no/single_choice/multiple_choice/short_text/numeric) now save; values in neither taxonomy still fail 23514; no existing rows touched',
		);
	},
	async down(client) {
		const { rows } = await client.query(
			`SELECT COUNT(*)::int AS n FROM question_bank WHERE question_type IN (${NEW_TYPES.map((t) => `'${t}'`).join(', ')})`,
		);
		if (rows[0].n > 0) {
			console.log(
				`Migration 292 down(): ${rows[0].n} question_bank row(s) carry newly-admitted question_type values (${NEW_TYPES.join(', ')}) — ` +
					'NOT restoring the original 5-value CHECK, because doing so would fail or require rewriting/deleting real recruiter questions. ' +
					'Remove or retype those rows first, then re-run down(). Widened CHECK left in place.',
			);
			return;
		}
		await client.query(
			'ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_question_bank_type;',
		);
		await client.query(
			`ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_type ${checkSql(ORIGINAL_TYPES)};`,
		);
		console.log(
			'Migration 292 down(): chk_question_bank_type restored to the original 5-value CHECK (no rows carried newly-admitted values)',
		);
	},
};
