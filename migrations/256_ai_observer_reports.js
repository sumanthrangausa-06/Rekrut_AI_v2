// Migration 256: ai_observer_reports table for E-008 AI Observer worker
// Issue #695 (S-047) — stores the observer's behavioral + integrity analysis.
// Reports are written when the session ends (flushing → complete).
// Erasure: covered in lib/erasureService.js from day one (spec §5.1).
// Retention: 30 days via S-077 cron extension (spec §5.3).

async function up(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS ai_observer_reports (
			id SERIAL PRIMARY KEY,
			interview_session_id INTEGER NOT NULL UNIQUE
				REFERENCES interview_sessions(id) ON DELETE CASCADE,
			livekit_room_name VARCHAR(255),
			observer_identity VARCHAR(255) NOT NULL,
			analysis JSONB NOT NULL DEFAULT '{}',
			integrity_summary JSONB NOT NULL DEFAULT '{}',
			consent_state VARCHAR(20) NOT NULL DEFAULT 'unknown'
				CHECK (consent_state IN ('granted', 'declined', 'withdrawn', 'unknown')),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)
	`);

	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_reports_session
		ON ai_observer_reports(interview_session_id)
	`);

	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_reports_room
		ON ai_observer_reports(livekit_room_name)
	`);
}

async function down(client) {
	await client.query(`DROP TABLE IF EXISTS ai_observer_reports`);
}

module.exports = { up, down };
