// =============================================================================
// Migration 278: allow 'published' in the job_assessments status CHECK
// (issue #1642)
// =============================================================================
//
// Root cause (#1642; Nova STOP 1 verification on dev b6efab0d3):
// migration 047 added chk_job_assessments_status as
// ('draft','active','archived') — omitting 'published', although:
//   - the publish handler has always written it: POST
//     /job-assessment/:id/publish does
//     UPDATE job_assessments SET status = 'published', published_at = NOW()
//     (routes/assessments.js:2756), so publishing a job assessment fails
//     with SQLSTATE 23514 on any DB built only by node migrate.js;
//   - the start handler requires it: POST /job-assessment/:id/start
//     selects WHERE status = 'published' (routes/assessments.js:2780),
//     and the referral create/preview paths gate on it too
//     (routes/assessments.js:2322, :2383) — so on a fresh install no job
//     assessment can ever be published, started, or referred;
//   - the create path relies on the column default 'draft'
//     (migrations/042_job_assessments.js:15; the only INSERT,
//     routes/assessments.js:2573, omits status), and readers treat
//     'archived' as the terminal/excluded state
//     (routes/assessments.js:2463-2464, :2646). 'active' has no writer
//     or reader but is in the 047 list and stays (expand-only). No
//     'closed' writer/reader exists for this table, so none is added.
//   - the assessment-phase-b journey rig already documented this drift
//     and widened the CHECK locally, rig-only, to exactly this list
//     (e2e/journeys/assessment-phase-b.js:329-335).
//
// Nova RED proof (fresh DB built only by node migrate.js, own local
// Postgres): the constraint read back as
// CHECK (status = ANY (ARRAY['draft','active','archived'])), a draft
// INSERT succeeded (control), and the publish handler's exact UPDATE
// failed with ERROR 23514 violating chk_job_assessments_status.
//
// Unlike #1610/migration 275, there is no second hidden constraint:
// migrations/p2_schema_hardening.sql does not re-add a job_assessments
// status CHECK (grep-verified), so the canonical name stays
// chk_job_assessments_status — 047's own name.
//
// EXPAND-ONLY: the new constraint is the old list plus 'published'. No
// value is removed, no row is rewritten, no column or data changes.
// Re-adding by definition lookup (migration 274/275 pattern), never by
// assumed state: drop every CHECK on job_assessments whose definition
// carries the status vocabulary ('status' + 'draft' + 'archived' —
// markers the sibling difficulty CHECK does not carry), then add the
// widened constraint. No exception handler anywhere: any failure
// propagates through migrate.js's per-file transaction (ROLLBACK, the
// _migrations row is not written, retried next run).
//
// down(): restores the 047 list. NOTE: down() will fail if any
// assessment is 'published' at that point — that is correct behaviour
// for a contraction; it is recorded here, not hidden.
// =============================================================================

module.exports = {
	name: '278_job_assessments_published_status',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'job_assessments'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%status%'
            AND pg_get_constraintdef(oid) ILIKE '%draft%'
            AND pg_get_constraintdef(oid) ILIKE '%archived%'
        LOOP
          EXECUTE 'ALTER TABLE job_assessments DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
      END $$;
    `);
		await client.query(`
      ALTER TABLE job_assessments
      ADD CONSTRAINT chk_job_assessments_status
      CHECK (status IN ('draft','active','archived','published'))
    `);
	},
	down: async (client) => {
		await client.query(`
      ALTER TABLE job_assessments
      DROP CONSTRAINT IF EXISTS chk_job_assessments_status
    `);
		await client.query(`
      ALTER TABLE job_assessments
      ADD CONSTRAINT chk_job_assessments_status
      CHECK (status IN ('draft','active','archived'))
    `);
	},
};
