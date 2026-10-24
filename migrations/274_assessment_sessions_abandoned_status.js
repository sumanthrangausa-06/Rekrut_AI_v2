// =============================================================================
// Migration 274: allow 'abandoned' in the assessment_sessions status CHECK
// (issues #1602 / #1606, Assessments Phase A)
// =============================================================================
//
// Migration 047 added chk_assessment_sessions_status as
// ('pending','active','in_progress','completed','expired','cancelled') —
// omitting 'abandoned', although:
//   - the start handler has always written it: POST /assessments/start
//     marks the candidate's previous in-progress session 'abandoned'
//     before creating the new one (routes/assessments.js), so starting the
//     same skill twice while an attempt is in progress fails the whole
//     start with a check-constraint 500 — an assessment that "does not
//     open" (#1606 class), found by the Phase A Quinn rig (JT-A3 leg: the
//     candidate who left a JavaScript attempt and started it again);
//   - 047's OWN sibling constraints in the same file include 'abandoned'
//     (job_assessment_attempts, mock_interview_sessions), and the PRD for
//     the assessments module (prd-assessments-module.md §4) records the
//     session status set as in_progress / completed / abandoned.
//
// EXPAND-ONLY: the new constraint is the old list plus 'abandoned'. No
// value is removed, no row is rewritten, no data changes. Re-adding by
// definition lookup (migration 268/271 pattern), never by assumed state.
//
// down(): restores the 047 list. NOTE: down() will fail if any session is
// 'abandoned' at that point — that is correct behaviour for a contraction;
// it is recorded here, not hidden.
// =============================================================================

module.exports = {
	name: '274_assessment_sessions_abandoned_status',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'assessment_sessions'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%status%'
            AND pg_get_constraintdef(oid) ILIKE '%in_progress%'
        LOOP
          EXECUTE 'ALTER TABLE assessment_sessions DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
      END $$;
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD CONSTRAINT chk_assessment_sessions_status
      CHECK (status IN ('pending','active','in_progress','completed','expired','cancelled','abandoned'))
    `);
	},
	down: async (client) => {
		await client.query(`
      ALTER TABLE assessment_sessions
      DROP CONSTRAINT IF EXISTS chk_assessment_sessions_status
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
      ADD CONSTRAINT chk_assessment_sessions_status
      CHECK (status IN ('pending','active','in_progress','completed','expired','cancelled'))
    `);
	},
};
