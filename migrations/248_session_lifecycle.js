// =============================================================================
// Migration 248: Session lifecycle columns (S-003, Issue #642, Phase 4 Sprint 2)
// =============================================================================
//
// New columns on interview_sessions:
//   last_heartbeat_at      — lazy pause evaluation (AC-1). When getState() sees
//                            an in_progress session whose heartbeat is > 60s
//                            stale, it transitions to paused in the same request.
//                            No cron, no background process (STOP 1 decision).
//   current_question_index — resume position (AC-2). 0-based index of the next
//                            unanswered question. Preserved across pause/resume.
//   paused_at              — UX timestamp for "paused 5 minutes ago" display.
//
// Safety:
//   - Every DDL statement uses IF NOT EXISTS (idempotent).
// =============================================================================

module.exports = {
	name: '248_session_lifecycle',
	up: async (client) => {
		await client.query(`
      ALTER TABLE interview_sessions
      ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ
    `);

		await client.query(`
      ALTER TABLE interview_sessions
      ADD COLUMN IF NOT EXISTS current_question_index INTEGER NOT NULL DEFAULT 0
    `);

		await client.query(`
      ALTER TABLE interview_sessions
      ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ
    `);

		// Heartbeat lookups: in_progress sessions ordered by staleness.
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_heartbeat
      ON interview_sessions(status, last_heartbeat_at)
      WHERE status = 'in_progress'
    `);
	},
};
