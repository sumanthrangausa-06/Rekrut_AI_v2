/**
 * Migration 235: interview invite expiry — 7-week max invite window.
 *
 * Adds `interview_sessions.invite_expires_at` (TIMESTAMPTZ). Invite links are
 * valid for 7 weeks from creation; the anonymous by-token resolver treats
 * expired 'invited' sessions as gone. Recruiters can resend to start a fresh
 * 7-week window (new token).
 *
 * Backfill: existing 'invited' sessions get created_at + 7 weeks, so their
 * window is measured from creation rather than from this migration.
 */
module.exports = {
	name: '235_interview_invite_expiry',
	up: async (client) => {
		await client.query(`
      ALTER TABLE interview_sessions
      ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ
    `);
		await client.query(`
      UPDATE interview_sessions
      SET invite_expires_at = created_at + INTERVAL '7 weeks'
      WHERE status = 'invited' AND invite_expires_at IS NULL
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_invite_expires
      ON interview_sessions (invite_expires_at)
    `);
		console.log('[migration:235] interview_sessions.invite_expires_at added');
	},
};
