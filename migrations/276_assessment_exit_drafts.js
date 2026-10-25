// =============================================================================
// Migration 276: Phase B (#1604/#1605) — exit-draft persistence + abandon timestamp
// (Assessments Phase B, unified exit dialog + full-screen policy)
//
// EXPAND-ONLY. Adds, on BOTH attempt tables:
//   - current_draft JSONB (nullable): the candidate's current-question work,
//     stored-but-not-answered at Save & Exit (design §8.2). Shape:
//       { questionId, answer, savedAt }. NULL = no draft.
//     Cleared when the drafted question is answered, or on any terminal
//     transition. Owner-only — never surfaced to recruiters, never scored.
//   - abandoned_at TIMESTAMP (nullable): when an attempt was exited without
//     a score (Exit Exam). The abandon claim sets this and leaves
//     completed_at NULL — a deliberate deviation from design §4.1's
//     `completed_at=NOW()` on abandon, taken on the ecc database-reviewer's
//     STOP 1 condition (M1-2): a completed_at timestamp on an unscored
//     attempt is a misread-class bug for every surface that keys completion
//     off it; consumer audit at build time confirmed no surface reads
//     assessment_sessions.completed_at as "completed" today, but the
//     dedicated column removes the class rather than relying on that audit.
//
// No CHECK changes, no status changes, no data movement, no constraints on
// existing columns. Safe on the shared staging/production DB while old code
// runs (old code ignores the new columns).
//
// down(): drops the four added columns and NOTHING else. Data-losing by
// definition (drafts written since up); raises a WARNING over any rows that
// carry data before dropping, so the loss is visible, not silent.
// =============================================================================

module.exports = {
	name: '276_assessment_exit_drafts',
	up: async (client) => {
		// Guard: a wrongly-typed legacy column with either name must fail
		// loudly rather than silently co-exist with the new meaning.
		await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'assessment_sessions' AND column_name = 'current_draft'
            AND data_type <> 'jsonb'
        ) THEN RAISE EXCEPTION 'assessment_sessions.current_draft exists with a non-JSONB type';
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'job_assessment_attempts' AND column_name = 'current_draft'
            AND data_type <> 'jsonb'
        ) THEN RAISE EXCEPTION 'job_assessment_attempts.current_draft exists with a non-JSONB type';
        END IF;
      END $$;
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
        ADD COLUMN IF NOT EXISTS current_draft JSONB,
        ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMP;
      ALTER TABLE job_assessment_attempts
        ADD COLUMN IF NOT EXISTS current_draft JSONB,
        ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMP;
    `);
	},
	down: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        drafts_s INT; drafts_j INT; aband_s INT; aband_j INT;
      BEGIN
        SELECT COUNT(*) INTO drafts_s FROM assessment_sessions WHERE current_draft IS NOT NULL;
        SELECT COUNT(*) INTO drafts_j FROM job_assessment_attempts WHERE current_draft IS NOT NULL;
        SELECT COUNT(*) INTO aband_s FROM assessment_sessions WHERE abandoned_at IS NOT NULL;
        SELECT COUNT(*) INTO aband_j FROM job_assessment_attempts WHERE abandoned_at IS NOT NULL;
        IF drafts_s + drafts_j + aband_s + aband_j > 0 THEN
          RAISE WARNING 'migration 276 down(): dropping drafts/abandon timestamps on % + % + % + % rows — candidate exit state written since up() is LOST',
            drafts_s, drafts_j, aband_s, aband_j;
        END IF;
      END $$;
    `);
		await client.query(`
      ALTER TABLE assessment_sessions
        DROP COLUMN IF EXISTS current_draft,
        DROP COLUMN IF EXISTS abandoned_at;
      ALTER TABLE job_assessment_attempts
        DROP COLUMN IF EXISTS current_draft,
        DROP COLUMN IF EXISTS abandoned_at;
    `);
	},
};
