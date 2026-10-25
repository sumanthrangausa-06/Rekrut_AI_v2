// Migration 255: observer_jobs table for E-008 AI Observer worker
// Issue #695 (S-047) — job queue for the invisible LiveKit observer bot.
// The worker claims pending jobs via SELECT FOR UPDATE SKIP LOCKED,
// joins the LiveKit room, and processes audio/video streams.
// UNIQUE on interview_session_id: one job per session, ever (idempotency).

async function up(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_jobs (
			id SERIAL PRIMARY KEY,
			interview_session_id INTEGER NOT NULL UNIQUE
				REFERENCES interview_sessions(id) ON DELETE CASCADE,
			status VARCHAR(20) NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending','claimed','observing','flushing','complete','cancelled','failed')),
			worker_id VARCHAR(255),
			claimed_at TIMESTAMPTZ,
			last_heartbeat TIMESTAMPTZ,
			attempt_count INTEGER NOT NULL DEFAULT 0,
			error_message TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)
	`);

	// Worker polling: find pending jobs to claim
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_jobs_status
		ON observer_jobs(status) WHERE status = 'pending'
	`);

	// Stale-claim recovery: find active jobs with dead heartbeats
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_jobs_heartbeat
		ON observer_jobs(last_heartbeat)
		WHERE status IN ('claimed','observing','flushing')
	`);
}

async function down(client) {
	await client.query(`DROP TABLE IF EXISTS observer_jobs`);
}

module.exports = { up, down };
