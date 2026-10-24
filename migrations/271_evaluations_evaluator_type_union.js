// =============================================================================
// Migration 271: interview_evaluations.evaluator_type CHECK — union vocabulary (#1508)
// =============================================================================
//
// Root cause (#1508; Scout audit + Rex design on the issue): the only writer
// of interview_evaluations, services/interview-ai.js runMultiEvaluation, has
// written one row per AI evaluation LENS — evaluator_type IN
// ('technical','culture','experience') — since 2026-02-13. The CHECK added
// by migrations/p2_schema_hardening.sql admits only the kind taxonomy
// ('ai','human','panel'), which has never had a writer or a reader. On a
// fresh install the .sql now executes and every writer insert is rejected;
// on a database that already held lens rows when the .sql first ran, the
// ADD failed validation and was silently swallowed by p2's
// EXCEPTION WHEN OTHERS THEN RAISE NOTICE block — so the shared
// staging/production DB's real constraint state is unknowable from code.
//
// Fix (Rex design, #1508): widen the CHECK to the UNION of both
// vocabularies —
//   ('technical', 'culture', 'experience', 'ai', 'human', 'panel')
// — an expand-only step: every value legal before stays legal, every value
// the writer produces becomes legal, and no row that could exist in either
// live state can be invalidated by the vocabulary itself. The writer is NOT
// changed (changing it to 'ai' would destroy the per-lens identity of the
// rows and break the #1505 honesty contract); no reader depends on the
// value. Whether human/panel evaluations will ever be rows in this table
// is a product question for Sumanth; the union forecloses neither answer,
// and a future lens-only narrowing would be a separate, data-checked
// contract migration.
//
// State-agnostic, idempotent: the existing CHECK is found BY DEFINITION
// via pg_constraint / pg_get_constraintdef (any CHECK on
// interview_evaluations whose definition references evaluator_type — the
// migration 268 pattern), and every match is dropped by its real name.
//   - State A (old CHECK present, any name): found and dropped.
//   - State B (CHECK absent — swallowed by p2, or never applied): the
//     loop finds nothing; the drop is a no-op, not an error.
//   - Re-run (record removed): the loop finds the union CHECK itself and
//     re-adds an identical one — a safe no-op in effect.
// Both live states converge to exactly one canonical constraint.
//
// Loudness (hard requirement — the p2 swallow must NOT be repeated): this
// migration contains NO exception handler anywhere — no EXCEPTION block,
// no try/catch. Any failure (e.g. a pre-existing row holding a value
// outside BOTH vocabularies) propagates through migrate.js's per-file
// transaction: ROLLBACK, exit 1, and the _migrations row is NOT written,
// so the migration is retried on the next run instead of being recorded
// as applied-but-not.
//
// Rollback: migrations never un-apply. Reversing this widening, if ever
// ruled, is a forward-fix migration (272+) — and once the writer has run
// post-271, lens rows exist, so in practice that means dropping the CHECK
// entirely or keeping the union. A failed 271 needs no rollback: its
// transaction already rolled back.
// =============================================================================

module.exports = {
	name: '271_evaluations_evaluator_type_union',
	up: async (client) => {
		// 1. Drop every existing evaluator_type CHECK on interview_evaluations,
		//    found by definition (migration 268 pattern) — never by assumed
		//    name or assumed presence.
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'interview_evaluations'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%evaluator_type%'
        LOOP
          EXECUTE format('ALTER TABLE interview_evaluations DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END
      $$;
    `);

		// 2. Add the canonical union constraint.
		await client.query(`
      ALTER TABLE interview_evaluations
        ADD CONSTRAINT chk_evaluations_evaluator_type
        CHECK (evaluator_type IN ('technical', 'culture', 'experience', 'ai', 'human', 'panel'))
    `);

		console.log(
			'Migration 271: interview_evaluations.evaluator_type CHECK widened to the union vocabulary (lens + kind) (#1508)',
		);
	},
};
