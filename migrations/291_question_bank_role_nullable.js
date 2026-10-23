// =============================================================================
// Migration 291: question_bank.role NOT NULL -> nullable (#1739)
// =============================================================================
//
// WHAT: drops the NOT NULL constraint on question_bank.role, so an INSERT
// that omits role stores NULL instead of failing with 23502.
//
// WHY: migration 031 created role as NOT NULL because the table's first
// writers were the AI question generators, which key every question by the
// target job role. Migration 036 then extended the same table for
// recruiter-saved questions (recruiter_id / category / options /
// usage_count), but the two recruiter writers never supply role:
//
//   - routes/memory.js    POST /question-bank (INSERT ~L173):
//       (question_text, question_type, category, options, recruiter_id,
//        usage_count)
//   - routes/recruiter.js POST /question-bank (INSERT ~L3162):
//       (recruiter_id, question_text, category, question_type, options)
//
// Every recruiter save therefore 500s on the role NOT NULL violation —
// the writer can never store the question it was asked to save.
//
// SEMANTICS: a NULL role means recruiter-saved, not role-keyed. The AI
// writers (routes/interviews.js, INSERTs ~L589 / ~L632) keep supplying
// role explicitly and are unaffected; role-keyed reads
// (LOWER(role) = LOWER($1)) simply never match NULL rows, which is the
// correct behaviour for questions that were never generated for a role.
//
// SCOPE LIMITS:
// - Writers are UNCHANGED (STOP 1 decision on #1739): the schema was the
//   defect, not the writers.
// - NO EXISTING ROWS ARE TOUCHED. DROP NOT NULL rewrites no data; it only
//   permits future INSERTs to omit the column.
// - NOT in scope: chk_question_bank_type (migrations/p2_schema_hardening.sql)
//   does not admit the recruiter writers' 'text' question_type default.
//   That is a separate defect, recorded on #1739 from the STOP 1
//   verification; this migration does not widen that CHECK.
//
// IDEMPOTENCY: DROP NOT NULL on an already-nullable column is a no-op in
// PostgreSQL, so up() may run any number of times. up() still re-reads
// information_schema afterwards and throws if role is missing or still
// NOT NULL, so the migration cannot record success over a schema that
// still rejects recruiter saves.
//
// down(): restores the 031 NOT NULL — but ONLY when no NULL-role rows
// exist. If recruiter-saved rows are present, restoring NOT NULL would
// fail (and any forced variant would have to invent roles for them, i.e.
// fabricate data), so down() logs that fact and leaves the column
// nullable: a deliberate safe no-op, recorded here, not hidden.
// migrate.js never calls down(); this is for manual rollback only.
// =============================================================================

module.exports = {
	name: '291_question_bank_role_nullable',
	async up(client) {
		await client.query(
			'ALTER TABLE question_bank ALTER COLUMN role DROP NOT NULL;',
		);

		// Post-state assertion: the column exists and is nullable.
		const check = await client.query(
			`SELECT is_nullable FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'role'`,
		);
		if (check.rows.length !== 1 || check.rows[0].is_nullable !== 'YES') {
			throw new Error(
				'Migration 291 post-state assertion failed: question_bank.role ' +
					(check.rows.length !== 1
						? 'column not found'
						: `is_nullable=${check.rows[0].is_nullable}, expected YES`),
			);
		}

		console.log(
			'Migration 291: question_bank.role is now nullable (#1739) — recruiter-saved questions store role NULL (recruiter-saved, not role-keyed); AI writers keep supplying role; no existing rows touched',
		);
	},
	async down(client) {
		const { rows } = await client.query(
			'SELECT COUNT(*)::int AS n FROM question_bank WHERE role IS NULL',
		);
		if (rows[0].n > 0) {
			console.log(
				`Migration 291 down(): ${rows[0].n} question_bank row(s) have role NULL (recruiter-saved) — ` +
					'NOT restoring NOT NULL, because doing so would fail or require inventing roles. ' +
					'Delete or backfill those rows first, then re-run down(). Column left nullable.',
			);
			return;
		}
		await client.query(
			'ALTER TABLE question_bank ALTER COLUMN role SET NOT NULL;',
		);
		console.log(
			'Migration 291 down(): question_bank.role restored to NOT NULL (no NULL-role rows existed)',
		);
	},
};
