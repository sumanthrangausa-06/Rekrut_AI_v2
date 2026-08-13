// =============================================================================
// Migration 127: LiveKit Video Infrastructure — Interview Rooms (Issue #124)
// =============================================================================
//
// Schema additions:
//   - interview_rooms  : Tracks LiveKit rooms linked to interview events
//
// Design decisions:
//   - interview_event_id references interview_events(id) for the scheduling flow.
//   - livekit_room_id stores the server-assigned room SID.
//   - status enum: active | closed (soft-close only; LiveKit room is deleted on close).
//   - Indexes on interview_event_id and status for fast lookups.
// =============================================================================

module.exports = {
	name: '127_livekit_interview_rooms',
	up: async (client) => {
		// ── interview_rooms ───────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS interview_rooms (
				id SERIAL PRIMARY KEY,
				interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE,
				room_name VARCHAR(255) NOT NULL,
				livekit_room_id VARCHAR(255) NOT NULL,
				status VARCHAR(50) NOT NULL DEFAULT 'active'
					CHECK (status IN ('active', 'closed')),
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				closed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
			)
		`);

		// ── Indexes ───────────────────────────────────────────────────────
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_rooms_event
			ON interview_rooms(interview_event_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_rooms_status
			ON interview_rooms(status)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_rooms_created_at
			ON interview_rooms(created_at DESC)
		`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_rooms_active_event
			ON interview_rooms(interview_event_id)
			WHERE status = 'active'
		`);

		console.log('[migration] LiveKit interview_rooms table created (Issue #124)');
	},
};
