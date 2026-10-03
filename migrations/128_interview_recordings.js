// =============================================================================
// Migration: Interview Recording Infrastructure (Issue #126)
// =============================================================================
//
// Tables:
//   interview_recordings  — recording session metadata
//   interview_transcripts — transcript segments with speaker attribution
//   recording_consent     — per-participant consent records
//   transcript_highlights — user-created highlights/comments
//
// Security:
//   - storage_path is encrypted (never raw S3 URLs)
//   - retention_expires_at drives auto-deletion
//   - consent enforced server-side before recording starts
// =============================================================================

module.exports = {
	name: 'interview_recordings',
	up: async (pool) => {
		// ─── interview_recordings ─────────────────────────────────────────────
		await pool.query(`
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

		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_recordings_event
      ON interview_recordings(interview_event_id)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_recordings_room
      ON interview_recordings(room_id)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_recordings_status
      ON interview_recordings(status)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_recordings_retention
      ON interview_recordings(retention_expires_at)
      WHERE status != 'deleted'
    `);

		// ─── interview_transcripts ────────────────────────────────────────────
		await pool.query(`
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

		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_transcripts_recording
      ON interview_transcripts(recording_id)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_transcripts_time
      ON interview_transcripts(recording_id, start_time_ms)
    `);

		// ─── recording_consent ────────────────────────────────────────────────
		await pool.query(`
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

		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_recording_consent_recording
      ON recording_consent(recording_id)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_recording_consent_user
      ON recording_consent(user_id)
    `);

		// ─── transcript_highlights ────────────────────────────────────────────
		await pool.query(`
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

		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transcript_highlights_transcript
      ON transcript_highlights(transcript_id)
    `);
		await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transcript_highlights_user
      ON transcript_highlights(user_id)
    `);
	},
	down: async (pool) => {
		await pool.query('DROP TABLE IF EXISTS transcript_highlights');
		await pool.query('DROP TABLE IF EXISTS recording_consent');
		await pool.query('DROP TABLE IF EXISTS interview_transcripts');
		await pool.query('DROP TABLE IF EXISTS interview_recordings');
	},
};
