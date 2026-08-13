// =============================================================================
// Migration 126: Calendar Integration — Interview Events & Proposed Slots (Issue #127)
// =============================================================================
//
// Schema additions for automated interview scheduling:
//   - interview_events    : Structured interview events with multi-attendee calendar sync
//   - proposed_slots      : Time slots offered to candidates for selection
//
// Also enhances calendar_connections with calendar_email for identity mapping.
//
// Design decisions:
//   - All times stored in UTC (timestamptz), converted to local timezone at display layer.
//   - calendar_event_ids stored as JSONB mapping attendee_user_id → external_event_id.
//   - panel_member_ids is an INTEGER[] array for fast membership checks.
//   - Soft-delete via is_active on calendar_connections; hard-delete on slots.
// =============================================================================

module.exports = {
	name: '126_interview_events_proposed_slots',
	up: async (client) => {
		// ── calendar_connections enhancements ─────────────────────────────
		await client.query(`
			ALTER TABLE calendar_connections
			ADD COLUMN IF NOT EXISTS calendar_email VARCHAR(255) DEFAULT NULL
		`);

		// Add comment documenting that access_token / refresh_token store AES-256-GCM ciphertext
		await client.query(`
			COMMENT ON COLUMN calendar_connections.access_token IS 'AES-256-GCM encrypted access token (ciphertext prefix: enc:v1:)'
		`);
		await client.query(`
			COMMENT ON COLUMN calendar_connections.refresh_token IS 'AES-256-GCM encrypted refresh token (ciphertext prefix: enc:v1:)'
		`);

		// ── interview_events ──────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS interview_events (
				id SERIAL PRIMARY KEY,
				job_application_id INTEGER REFERENCES job_applications(id) ON DELETE CASCADE,
				recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				panel_member_ids INTEGER[] DEFAULT '{}',
				scheduled_at TIMESTAMP WITH TIME ZONE,
				duration_minutes INTEGER NOT NULL DEFAULT 60,
				timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
				status VARCHAR(50) NOT NULL DEFAULT 'proposed'
					CHECK (status IN ('proposed', 'confirmed', 'cancelled', 'rescheduled', 'completed')),
				calendar_event_ids JSONB DEFAULT NULL,
				livekit_room_url TEXT DEFAULT NULL,
				meeting_link TEXT DEFAULT NULL,
				notes TEXT DEFAULT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);

		// ── proposed_slots ────────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS proposed_slots (
				id SERIAL PRIMARY KEY,
				interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE,
				proposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				slot_start TIMESTAMP WITH TIME ZONE NOT NULL,
				slot_end TIMESTAMP WITH TIME ZONE NOT NULL,
				timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
				status VARCHAR(50) NOT NULL DEFAULT 'offered'
					CHECK (status IN ('offered', 'accepted', 'rejected', 'expired')),
				candidate_response_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);

		// ── Indexes for performance ───────────────────────────────────────
		// interview_events
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_job_application
			ON interview_events(job_application_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_recruiter
			ON interview_events(recruiter_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_candidate
			ON interview_events(candidate_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_status
			ON interview_events(status)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_scheduled_at
			ON interview_events(scheduled_at)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_panel_member
			ON interview_events USING gin(panel_member_ids)
		`);

		// proposed_slots
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_proposed_slots_event
			ON proposed_slots(interview_event_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_proposed_slots_status
			ON proposed_slots(status)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_proposed_slots_start
			ON proposed_slots(slot_start)
		`);

		// calendar_connections
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_calendar_connections_email
			ON calendar_connections(calendar_email)
			WHERE calendar_email IS NOT NULL
		`);

		console.log('[migration] Interview events & proposed slots tables created (Issue #127)');
	},
};
