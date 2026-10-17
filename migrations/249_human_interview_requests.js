// =============================================================================
// Migration 249: Human interview requests (S-012, Issue #651, Phase 4 Sprint 2)
// =============================================================================
//
// S-012: when a candidate declines biometric consent and accepts the
// human-interview offer (S-010 AC-4), they can request a human interview.
// The recruiter approves (creates a human-mode session with
// biometric_collection: false) or declines (candidate is notified).
//
// Table:
//   human_interview_requests — one row per requesting session.
//     session_id   — the session where consent was declined (UNIQUE: one
//                    request per session prevents duplicate recruiter pings)
//     candidate_id — who requested
//     recruiter_id — session.triggered_by; notified on request (AC-1)
//     status       — pending → approved | declined (AC-2)
//     decided_at / decided_by — audit of the recruiter's decision
//
// Safety:
//   - CREATE TABLE IF NOT EXISTS (idempotent)
//   - CHECK constraint on status (fail-closed on bad values)
// =============================================================================

module.exports = {
	name: '249_human_interview_requests',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS human_interview_requests (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES interview_sessions(id),
        candidate_id INTEGER NOT NULL REFERENCES users(id),
        recruiter_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ,
        decided_by INTEGER REFERENCES users(id),
        UNIQUE (session_id)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_interview_requests_recruiter
        ON human_interview_requests (recruiter_id, status)
    `);
	},
};
