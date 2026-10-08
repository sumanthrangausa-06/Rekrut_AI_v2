/**
 * Migration 139: session-linked LiveKit rooms (#323).
 *
 * Phase 2 keys LiveKit rooms to the unified interview_sessions model
 * (migration 129), not just the legacy interview_events model. This migration:
 *
 *   1. Drops NOT NULL on interview_rooms.interview_event_id — a room is now
 *      linked to EITHER an interview_event (legacy) OR an interview_session
 *      (Phase 2). Existing rows always carry an event id, so no data changes.
 *   2. Adds interview_session_id (nullable FK, ON DELETE CASCADE).
 *
 * Old writers (autoCreateRoomForInterview) are untouched and keep working.
 */

module.exports = {
	name: 'interview_rooms_session_link',
	up: async (client) => {
		await client.query(`
			ALTER TABLE interview_rooms
			ALTER COLUMN interview_event_id DROP NOT NULL
		`);

		await client.query(`
			ALTER TABLE interview_rooms
			ADD COLUMN IF NOT EXISTS interview_session_id INTEGER
				REFERENCES interview_sessions(id) ON DELETE CASCADE
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_rooms_session
			ON interview_rooms(interview_session_id)
		`);
	},
};
