// =============================================================================
// Migration 129: Unified interview_sessions table (Issue #322, Phase 1)
// =============================================================================
//
// New table:
//   interview_sessions — one row per screening / AI interview / practice /
//   human-scheduled session, replacing the split between screening_sessions,
//   mock_interview_sessions, scheduled_interviews and interview_rooms.
//
// Extensions (nullable — existing flows keep working):
//   interview_recordings.interview_session_id  → link recordings to sessions
//   interview_evaluations.interview_session_id → link evaluations to sessions
//
// Safety:
//   - Every DDL statement uses IF NOT EXISTS (may run where 128 never ran —
//     precedent: migration 230 never ran on staging).
//   - Migration 128's tables are re-asserted verbatim below.
// =============================================================================

module.exports = {
	name: '129_interview_sessions_unified',
	up: async (client) => {
		// ─── Re-assert migration 128 tables (verbatim DDL) ────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_recordings (
        id SERIAL PRIMARY KEY,
        interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
        livekit_egress_id VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'recording', 'processing', 'completed', 'failed', 'deleted')),
        started_at TIMESTAMP WITH TIME ZONE,
        stopped_at TIMESTAMP WITH TIME ZONE,
        duration_seconds INTEGER,
        -- Encrypted storage reference (never raw S3/R2 URLs)
        storage_path BYTEA,
        -- Reference to the encryption key used (supports key rotation)
        encryption_key_id VARCHAR(100) DEFAULT 'default',
        file_size_bytes BIGINT,
        file_format VARCHAR(20) DEFAULT 'mp4',
        -- Retention policy: auto-delete after this date
        retention_expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_transcripts (
        id SERIAL PRIMARY KEY,
        recording_id INTEGER NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
        speaker_identity VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        start_time_ms BIGINT NOT NULL,
        end_time_ms BIGINT NOT NULL,
        confidence DECIMAL(4,3) CHECK (confidence >= 0 AND confidence <= 1),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE TABLE IF NOT EXISTS recording_consent (
        id SERIAL PRIMARY KEY,
        recording_id INTEGER NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        consented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        consent_type VARCHAR(50) NOT NULL DEFAULT 'explicit'
          CHECK (consent_type IN ('explicit', 'implicit', 'withdrawn')),
        ip_address INET,
        user_agent TEXT,
        UNIQUE(recording_id, user_id)
      )
    `);

		await client.query(`
      CREATE TABLE IF NOT EXISTS transcript_highlights (
        id SERIAL PRIMARY KEY,
        transcript_id INTEGER NOT NULL REFERENCES interview_transcripts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        highlight_timestamp_ms BIGINT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		// ─── Unified sessions table ──────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_sessions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL DEFAULT 'screening',
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        invite_token VARCHAR(128) UNIQUE,
        status VARCHAR(50) DEFAULT 'invited',
        config JSONB NOT NULL DEFAULT '{}',
        conversation JSONB NOT NULL DEFAULT '[]',
        frame_analysis JSONB DEFAULT '{}',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

		// ─── Nullable links from existing tables ─────────────────────────────
		await client.query(`
      ALTER TABLE interview_recordings
      ADD COLUMN IF NOT EXISTS interview_session_id INTEGER REFERENCES interview_sessions(id) ON DELETE CASCADE
    `);

		// Matches interview_evaluations convention: plain INTEGER, no FK
		// (see interview_id / screening_session_id in migration 041).
		await client.query(`
      ALTER TABLE interview_evaluations
      ADD COLUMN IF NOT EXISTS interview_session_id INTEGER
    `);

		// ─── Indexes ─────────────────────────────────────────────────────────
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_candidate ON interview_sessions(candidate_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_job ON interview_sessions(job_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_status ON interview_sessions(status)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_token ON interview_sessions(invite_token)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_type ON interview_sessions(type)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_recordings_session ON interview_recordings(interview_session_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_evaluations_session ON interview_evaluations(interview_session_id)
    `);

		// ─── Backfill: screening_sessions → type='screening' ─────────────────
		await client.query(`
      INSERT INTO interview_sessions
        (type, job_id, application_id, candidate_id, company_id, triggered_by,
         invite_token, status, config, conversation, frame_analysis,
         started_at, completed_at, created_at)
      SELECT
        'screening',
        job_id, application_id, candidate_id, company_id, invited_by,
        invite_token, status,
        jsonb_build_object('template_id', template_id, 'questions', questions),
        COALESCE(conversation, '[]'),
        '{}',
        started_at, completed_at,
        COALESCE(invited_at, NOW())
      FROM screening_sessions
    `);

		// ─── Backfill: mock_interview_sessions → type='practice' ─────────────
		await client.query(`
      INSERT INTO interview_sessions
        (type, candidate_id, status, config, conversation, started_at, completed_at)
      SELECT
        'practice',
        user_id,
        status,
        jsonb_build_object(
          'target_role', target_role,
          'job_description', job_description,
          'jd_hash', jd_hash,
          'question_ids', to_jsonb(question_ids),
          'current_question_index', current_question_index,
          'questions_asked', questions_asked,
          'follow_ups_asked', follow_ups_asked,
          'overall_score', overall_score,
          'overall_feedback', overall_feedback
        ),
        COALESCE(conversation, '[]'),
        started_at, completed_at
      FROM mock_interview_sessions
    `);

		console.log('Migration 129: interview_sessions unified table created and backfilled');
	},
	down: async (client) => {
		await client.query(
			'ALTER TABLE interview_recordings DROP COLUMN IF EXISTS interview_session_id',
		);
		await client.query(
			'ALTER TABLE interview_evaluations DROP COLUMN IF EXISTS interview_session_id',
		);
		await client.query('DROP TABLE IF EXISTS interview_sessions');
	},
};
