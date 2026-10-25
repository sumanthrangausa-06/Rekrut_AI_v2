// =============================================================================
// Migration 293: widen chk_scheduled_interviews_status to the canonical
// union vocabulary — allow 'reschedule_requested' (#1788)
// =============================================================================
//
// Root cause (#1788, P1 CONFIRMED; Rex design
// docs/sdlc/rekrut-ai-v2/03-solutioning/interview-reschedule-vocabulary/
// design.md, PR #1794 — D1/D2/D3): routes/candidate.js
// PUT /interviews/:id/reschedule writes status = 'reschedule_requested'
// into scheduled_interviews, and every reader already speaks that value
// (candidate interviews page badge + upcoming filter, recruiter
// interviews page badge + the Confirm button it gates, recruiter
// dashboard needs-action filter). But BOTH historical definitions of
// chk_scheduled_interviews_status forbid it:
//
//   1. migrations/047_p2_schema_hardening.js:632-634
//      CHECK (status IN ('scheduled','confirmed','in_progress',
//                        'completed','cancelled','no_show'))
//   2. migrations/p2_schema_hardening.sql:2809
//      CHECK (status IN ('scheduled','confirmed','completed',
//                        'cancelled','no_show','rescheduled'))
//
// The two definitions also disagree with each other ('in_progress' only
// in 047, 'rescheduled' only in p2). migrate.js sorts numbered files
// before p2_schema_hardening.sql, so on a fresh install 047's constraint
// lands first under the name chk_scheduled_interviews_status and p2's
// block — guarded by IF NOT EXISTS (constraint_name =
// 'chk_scheduled_interviews_status') — is skipped: the fresh-DB
// vocabulary is 047's list. Nova's RED reproduction on a migrate-only DB
// built from pristine dev (97aacaee3) proved it live over real HTTP:
// PUT /api/candidate/interviews/1/reschedule -> HTTP 500, server log
// PG 23514 on chk_scheduled_interviews_status, row unchanged — every
// candidate reschedule request silently never happens (the #1783 defect
// class, sibling route). The writer and the readers agree; the schema
// is the only side of the contract that is wrong (the migration 275 /
// 292 precedent for exactly this class).
//
// Fix (design §7, 268/271/275 by-definition pattern): widen-only to the
// canonical union — the superset of BOTH historical lists plus
// 'reschedule_requested'. Find EVERY CHECK on scheduled_interviews
// whose definition carries the status vocabulary (the marker pair
// '%status%' + '%no_show%' matches both historical definitions and does
// NOT match the outcome CHECK, which contains neither marker), drop
// each by its real name, then re-add ONE canonical constraint. The
// outcome CHECK (chk_scheduled_interviews_outcome) is not touched.
//
// Canonical NAME — load-bearing, not cosmetic: the re-added constraint
// carries the exact historical name chk_scheduled_interviews_status,
// the name p2_schema_hardening.sql's status block guards on. Any other
// name would let p2 re-add its narrower list on a fresh install,
// leaving TWO status CHECKs and the defect alive behind the fix.
//
// Expand -> migrate -> contract accounting (design §7.2):
//   - Expand: this migration. No value removed, no column touched, no
//     row read or rewritten; the union is a strict superset of both
//     historical vocabularies, so re-validation cannot fail on data.
//   - Migrate (data): none — no stored row can hold
//     'reschedule_requested' today (the CHECK saw to that) and every
//     other stored value stays lawful under the union.
//   - Contract: none scheduled — the union IS the canonical vocabulary
//     (design D2), not a transitional superset.
//
// State-agnostic, idempotent:
//   - Fresh DB (047's constraint only): found and replaced.
//   - Shared DB (either historical definition live, or both somehow
//     present — 047's addConstraint swallows ADD failures, so live
//     state is unknowable from code): the sweep finds what exists.
//   - Re-run (record removed): the sweep finds the widened constraint
//     itself (its definition carries the same markers) and re-adds an
//     identical one — a safe no-op in effect.
// All states converge to exactly one canonical constraint.
//
// Loudness (hard requirement — the swallows that hid this class must
// NOT be repeated): this migration contains NO exception handler
// anywhere — no EXCEPTION block, no try/catch. Any failure propagates
// through migrate.js's per-file transaction: ROLLBACK, exit 1, and the
// _migrations row is NOT written, so the migration is retried on the
// next run instead of being recorded as applied-but-not.
//
// Rollback: migrations never un-apply on the shared DB. Reversal, if
// ever ruled, is a forward migration — and once a candidate has
// successfully requested a reschedule, it would first have to decide
// where those rows go. down() below follows migration 274's honesty
// precedent: it refuses to narrow while any 'reschedule_requested' or
// 'rescheduled' row exists (values the 047 list forbids), because
// narrowing then would fail or require rewriting real rows.
// =============================================================================

const CANONICAL_STATUSES = [
	'scheduled',
	'confirmed',
	'in_progress',
	'completed',
	'cancelled',
	'no_show',
	'rescheduled',
	'reschedule_requested',
];

module.exports = {
	name: '293_scheduled_interviews_status_union',
	up: async (client) => {
		// 1. Drop every existing status-vocabulary CHECK on
		//    scheduled_interviews, found by definition (migration
		//    268/271/275 pattern) — never by assumed name or assumed
		//    presence. Both historical constraints match the marker
		//    pair ('%status%' + '%no_show%'); the outcome CHECK
		//    contains neither marker and survives untouched.
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'scheduled_interviews'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
            AND pg_get_constraintdef(oid) LIKE '%no_show%'
        LOOP
          EXECUTE format('ALTER TABLE scheduled_interviews DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END
      $$;
    `);

		// 2. Add the canonical widened constraint: the union of both
		//    historical lists plus 'reschedule_requested'. Expand-only
		//    — no value removed. The name is the historical
		//    chk_scheduled_interviews_status: p2_schema_hardening.sql
		//    runs after every numbered migration and its
		//    IF NOT EXISTS guard keys on this name (see header).
		await client.query(`
      ALTER TABLE scheduled_interviews
      ADD CONSTRAINT chk_scheduled_interviews_status
      CHECK (status IN (${CANONICAL_STATUSES.map((s) => `'${s}'`).join(', ')}))
    `);
	},
	async down(client) {
		// Honesty note (migration 274 precedent): narrowing back to
		// 047's list fails, correctly, while any row carries a value
		// that list forbids ('reschedule_requested' or 'rescheduled').
		// migrate.js never calls down(); manual only.
		const { rows } = await client.query(
			`SELECT COUNT(*)::int AS n FROM scheduled_interviews WHERE status IN ('reschedule_requested', 'rescheduled')`,
		);
		if (rows[0].n > 0) {
			console.log(
				`Migration 293 down(): ${rows[0].n} scheduled_interviews row(s) carry status values the original 047 CHECK forbids ` +
					'(reschedule_requested / rescheduled) — NOT restoring the narrower CHECK, because doing so would fail or ' +
					'require rewriting real interview rows. Move those rows to a lawful status first, then re-run down(). ' +
					'Widened CHECK left in place.',
			);
			return;
		}
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'scheduled_interviews'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
            AND pg_get_constraintdef(oid) LIKE '%no_show%'
        LOOP
          EXECUTE format('ALTER TABLE scheduled_interviews DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END
      $$;
    `);
		await client.query(`
      ALTER TABLE scheduled_interviews
      ADD CONSTRAINT chk_scheduled_interviews_status
      CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'))
    `);
		console.log(
			'Migration 293 down(): chk_scheduled_interviews_status restored to the original 047 6-value CHECK (no rows carried widened-only values)',
		);
	},
};
