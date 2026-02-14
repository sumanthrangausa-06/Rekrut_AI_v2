module.exports = {
  name: 'p1_interview_flow_schema',
  up: async (client) => {
    // =============================================
    // P1 FIX: Interview Flow Schema Issues
    // Fixes: timestamptz, NOT NULL, FKs, indexes, updated_at
    // =============================================

    // --- Phase 1: Convert timestamp → timestamptz ---
    // Per PostgreSQL best practices: NEVER use timestamp without time zone

    // interviews (3 columns)
    await client.query(`
      ALTER TABLE interviews
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC'
    `);

    // scheduled_interviews (3 columns)
    await client.query(`
      ALTER TABLE scheduled_interviews
        ALTER COLUMN scheduled_at TYPE timestamptz USING scheduled_at AT TIME ZONE 'UTC',
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC'
    `);

    // interview_questions (1 column)
    await client.query(`
      ALTER TABLE interview_questions
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
    `);

    // interview_evaluations (1 column)
    await client.query(`
      ALTER TABLE interview_evaluations
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
    `);

    // interview_analysis (1 column)
    await client.query(`
      ALTER TABLE interview_analysis
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
    `);

    // interview_composite_scores (1 column)
    await client.query(`
      ALTER TABLE interview_composite_scores
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
    `);

    // interview_reminders (2 columns)
    await client.query(`
      ALTER TABLE interview_reminders
        ALTER COLUMN send_at TYPE timestamptz USING send_at AT TIME ZONE 'UTC',
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
    `);

    // mock_interview_sessions (2 columns)
    await client.query(`
      ALTER TABLE mock_interview_sessions
        ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
        ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC'
    `);

    // --- Phase 2: Add NOT NULL constraints on critical columns ---
    // All verified: no NULL values exist in populated tables, empty tables are safe

    // interviews (8 rows): user_id, status, interview_type, created_at, updated_at
    await client.query(`
      ALTER TABLE interviews
        ALTER COLUMN user_id SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN interview_type SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at SET NOT NULL
    `);

    // scheduled_interviews (3 rows): company_id, job_id, candidate_id, interview_type, status, created_at, updated_at
    await client.query(`
      ALTER TABLE scheduled_interviews
        ALTER COLUMN company_id SET NOT NULL,
        ALTER COLUMN job_id SET NOT NULL,
        ALTER COLUMN candidate_id SET NOT NULL,
        ALTER COLUMN interview_type SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at SET NOT NULL
    `);

    // interview_evaluations (0 rows): created_at
    await client.query(`
      ALTER TABLE interview_evaluations
        ALTER COLUMN created_at SET NOT NULL
    `);

    // interview_analysis (0 rows): interview_id, created_at
    await client.query(`
      ALTER TABLE interview_analysis
        ALTER COLUMN interview_id SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL
    `);

    // interview_composite_scores (0 rows): created_at
    await client.query(`
      ALTER TABLE interview_composite_scores
        ALTER COLUMN created_at SET NOT NULL
    `);

    // interview_questions (0 rows): created_at
    await client.query(`
      ALTER TABLE interview_questions
        ALTER COLUMN created_at SET NOT NULL
    `);

    // interview_reminders (0 rows): interview_id, recipient_id, sent, created_at
    await client.query(`
      ALTER TABLE interview_reminders
        ALTER COLUMN interview_id SET NOT NULL,
        ALTER COLUMN recipient_id SET NOT NULL,
        ALTER COLUMN sent SET NOT NULL,
        ALTER COLUMN created_at SET NOT NULL
    `);

    // mock_interview_sessions (14 rows): user_id, status, started_at
    await client.query(`
      ALTER TABLE mock_interview_sessions
        ALTER COLUMN user_id SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN started_at SET NOT NULL
    `);

    // --- Phase 3: Add missing FK constraints ---
    // interview_evaluations and interview_composite_scores missing FKs to interviews and screening_sessions

    await client.query(`
      ALTER TABLE interview_evaluations
        ADD CONSTRAINT interview_evaluations_interview_id_fkey
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    `);

    await client.query(`
      ALTER TABLE interview_evaluations
        ADD CONSTRAINT interview_evaluations_screening_session_id_fkey
        FOREIGN KEY (screening_session_id) REFERENCES screening_sessions(id)
    `);

    await client.query(`
      ALTER TABLE interview_composite_scores
        ADD CONSTRAINT interview_composite_scores_interview_id_fkey
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    `);

    await client.query(`
      ALTER TABLE interview_composite_scores
        ADD CONSTRAINT interview_composite_scores_screening_session_id_fkey
        FOREIGN KEY (screening_session_id) REFERENCES screening_sessions(id)
    `);

    // --- Phase 4: Add missing FK indexes ---
    // Per PostgreSQL best practices: FK columns MUST have manual indexes

    // interviews
    await client.query(`CREATE INDEX idx_interviews_user_id ON interviews(user_id)`);
    await client.query(`CREATE INDEX idx_interviews_job_id ON interviews(job_id)`);

    // interview_evaluations
    await client.query(`CREATE INDEX idx_interview_evaluations_interview_id ON interview_evaluations(interview_id)`);
    await client.query(`CREATE INDEX idx_interview_evaluations_job_id ON interview_evaluations(job_id)`);
    await client.query(`CREATE INDEX idx_interview_evaluations_company_id ON interview_evaluations(company_id)`);

    // interview_composite_scores
    await client.query(`CREATE INDEX idx_interview_composite_scores_interview_id ON interview_composite_scores(interview_id)`);
    await client.query(`CREATE INDEX idx_interview_composite_scores_job_id ON interview_composite_scores(job_id)`);
    await client.query(`CREATE INDEX idx_interview_composite_scores_company_id ON interview_composite_scores(company_id)`);
    await client.query(`CREATE INDEX idx_interview_composite_scores_screening ON interview_composite_scores(screening_session_id)`);

    // interview_reminders
    await client.query(`CREATE INDEX idx_interview_reminders_interview_id ON interview_reminders(interview_id)`);
    await client.query(`CREATE INDEX idx_interview_reminders_recipient_id ON interview_reminders(recipient_id)`);

    // scheduled_interviews
    await client.query(`CREATE INDEX idx_scheduled_interviews_candidate_id ON scheduled_interviews(candidate_id)`);
    await client.query(`CREATE INDEX idx_scheduled_interviews_recruiter_id ON scheduled_interviews(recruiter_id)`);
    await client.query(`CREATE INDEX idx_scheduled_interviews_job_id ON scheduled_interviews(job_id)`);

    // --- Phase 5: Add missing updated_at columns ---
    // 5 tables lacked updated_at — critical for tracking data modifications

    await client.query(`
      ALTER TABLE interview_evaluations
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      ALTER TABLE interview_analysis
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      ALTER TABLE interview_composite_scores
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      ALTER TABLE interview_questions
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      ALTER TABLE interview_reminders
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);
  }
};
