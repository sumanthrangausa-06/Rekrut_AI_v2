// =============================================================================
// Migration 277: Phase B (#1604/#1605) — job-runner completion flags + integrity events
// (Assessments Phase B; split from the drafts migration on the ecc
//  database-reviewer's STOP 1 condition — independent rollback granularity
//  for the candidate-draft store and the attempt-flag/event store.)
//
// EXPAND-ONLY. Adds to job_assessment_attempts only (the skill runner has
// equivalent stores already: skill_assessments.behavioral_flags JSONB and the
// assessment_events table — design §8.3):
//   - completion_flags JSONB NOT NULL DEFAULT '{}': the completion marker
//     home — { partial, answers_given, total_questions,
//     fullscreen_auto_submit } for partial / auto-submitted completions
//     (design §5.2). Written inside the submit claim transaction.
//   - integrity_events JSONB NOT NULL DEFAULT '[]': the persisted event
//     store for this runner's FULL event vocabulary (design §7.2). Elements:
//       { type, timestamp (server receipt), data }.
//     Before this column, the job /event endpoint returned {logged:true} for
//     event types it recorded nowhere — a dropped full-screen event was a
//     false acknowledgement.
//
// No CHECK changes, no status changes. Safe on the shared staging/production
// DB while old code runs (old code ignores the new columns).
//
// down(): drops the two added columns and NOTHING else. Data-losing by
// definition (flags/events written since up); raises a WARNING over any
// rows that carry non-default data before dropping.
// =============================================================================

module.exports = {
	name: '277_job_attempt_flags_events',
	up: async (client) => {
		await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'job_assessment_attempts' AND column_name = 'completion_flags'
            AND data_type <> 'jsonb'
        ) THEN RAISE EXCEPTION 'job_assessment_attempts.completion_flags exists with a non-JSONB type';
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'job_assessment_attempts' AND column_name = 'integrity_events'
            AND data_type <> 'jsonb'
        ) THEN RAISE EXCEPTION 'job_assessment_attempts.integrity_events exists with a non-JSONB type';
        END IF;
      END $$;
    `);
		await client.query(`
      ALTER TABLE job_assessment_attempts
        ADD COLUMN IF NOT EXISTS completion_flags JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS integrity_events JSONB DEFAULT '[]'::jsonb;
    `);
		// Backfill any rows the defaults could not reach (e.g. a pre-existing
		// nullable column from an earlier partial application), then enforce.
		await client.query(`
      UPDATE job_assessment_attempts SET completion_flags = '{}'::jsonb WHERE completion_flags IS NULL;
      UPDATE job_assessment_attempts SET integrity_events = '[]'::jsonb WHERE integrity_events IS NULL;
      ALTER TABLE job_assessment_attempts
        ALTER COLUMN completion_flags SET NOT NULL,
        ALTER COLUMN integrity_events SET NOT NULL;
    `);
	},
	down: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        flags_n INT; events_n INT;
      BEGIN
        SELECT COUNT(*) INTO flags_n FROM job_assessment_attempts WHERE completion_flags <> '{}'::jsonb;
        SELECT COUNT(*) INTO events_n FROM job_assessment_attempts WHERE integrity_events <> '[]'::jsonb;
        IF flags_n + events_n > 0 THEN
          RAISE WARNING 'migration 277 down(): dropping completion flags on % rows and integrity events on % rows — data written since up() is LOST',
            flags_n, events_n;
        END IF;
      END $$;
    `);
		await client.query(`
      ALTER TABLE job_assessment_attempts
        DROP COLUMN IF EXISTS completion_flags,
        DROP COLUMN IF EXISTS integrity_events;
    `);
	},
};
