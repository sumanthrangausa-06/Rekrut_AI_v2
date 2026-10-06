// Migration 130: allow session-linked recordings (#322, Task 4).
//
// interview_recordings was built for the LiveKit flow with
// interview_event_id / room_id NOT NULL. Unified interview sessions link
// recordings via interview_session_id instead (Task 1), so the LiveKit
// columns become nullable, guarded by a CHECK that exactly one source
// (interview event XOR interview session) is set.
//
// DROP NOT NULL is idempotent in Postgres (no-op when already nullable),
// and the CHECK is added only if missing — safe to re-run.

module.exports = {
	name: '130_recordings_session_nullable',

	async up(client) {
		await client.query(
			`ALTER TABLE interview_recordings ALTER COLUMN interview_event_id DROP NOT NULL`,
		);
		await client.query(`ALTER TABLE interview_recordings ALTER COLUMN room_id DROP NOT NULL`);
		await client.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_interview_recordings_source') THEN
					ALTER TABLE interview_recordings
					ADD CONSTRAINT chk_interview_recordings_source
					CHECK ((interview_event_id IS NOT NULL) <> (interview_session_id IS NOT NULL));
				END IF;
			END $$;
		`);
	},

	async down(client) {
		await client.query(
			`ALTER TABLE interview_recordings DROP CONSTRAINT IF EXISTS chk_interview_recordings_source`,
		);
		// Only restore NOT NULL when no session-linked rows exist — otherwise
		// data would be orphaned.
		await client.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM interview_recordings WHERE interview_event_id IS NULL) THEN
					ALTER TABLE interview_recordings ALTER COLUMN interview_event_id SET NOT NULL;
				END IF;
				IF NOT EXISTS (SELECT 1 FROM interview_recordings WHERE room_id IS NULL) THEN
					ALTER TABLE interview_recordings ALTER COLUMN room_id SET NOT NULL;
				END IF;
			END $$;
		`);
	},
};
