// =============================================================================
// Migration 298: Event→session bridge for the diarization consent gate — #1925
// =============================================================================
//
// Epic #1900, follow-up #1925 (hard blocker for S-D17 #1919). Design: Rex,
// ADR-D06 (docs/sdlc/rekrut-ai-v2/03-solutioning/speaker-labelled-transcripts/
// event-session-bridge-design.md §3). NOTE: the design named this migration
// "297"; 297 was taken by S-D15 (biometric consent v1.2, PR #1948), so the
// bridge migration is 298 — correction recorded in the design doc itself.
//
// WHAT (expand-only — nothing renamed, dropped, narrowed, or backfilled):
//   1. interview_events.interview_session_id INTEGER NULL
//      REFERENCES interview_sessions(id) ON DELETE SET NULL + index.
//      The bridge link: the event's own governing session. NULL = no
//      governing session (all pre-bridge events) → the diarization gate
//      blocks NO_GOVERNING_SESSION. SET NULL, not CASCADE: deleting a
//      session must never delete an event; a dangling link degrades to
//      the blocked posture, not to data loss.
//   2. diarization_jobs.governing_session_id / consent_receipt_id
//      INTEGER NULL — gate provenance written at claim time.
//   3. diarization_runs.governing_session_id / consent_receipt_id
//      INTEGER NULL — the durable authorization record stored alongside
//      the produced labels at persistStitch time.
//      The provenance columns are PLAIN integers, deliberately no FK:
//      they are a historical snapshot of what authorized (or failed to
//      authorize) a decision; FKs would let later deletes rewrite it.
//      (DB-reviewer condition, #1925, in the migration-296 deviation
//      style: CASCADE would erase the record, SET NULL would falsify
//      it, RESTRICT would block lawful later deletion — cf. migration
//      245 dropping the FK on consent_receipts.interview_session_id.
//      Precedent: migration 129's plain-INTEGER no-FK columns.)
//      There is likewise deliberately NO index on the provenance
//      columns: no query path filters jobs/runs by session or receipt
//      — provenance is read from the job/run row itself. If a future
//      compliance-audit query needs one, it lands as its own expand
//      migration. The bridge-link index IS partial (WHERE NOT NULL):
//      it exists for the FK's SET NULL fan-out on session deletes, and
//      legacy NULL rows — the majority at first — stay out of it.
//
// No change to interview_recordings (the migration-130 XOR stands), no
// change to consent_receipts, no backfill of any kind.
//
// EXECUTION GATE (design §4.4 discipline): designed and proven on the
// local rig only in #1925. Executes on the shared Neon database only
// after the Nov 1 unfreeze, in dev → staging → main promotion order.
//
// Safety: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS; the FK
// rides the column add (a re-run skips it with the column). Post-state
// assertions (migration 296 pattern) fail loudly rather than recording
// success over a wrong schema.
//
// down(): migrations never un-apply on the shared database (rollback
// is by forward fix only), so down() is intentionally a no-op that logs.
// =============================================================================

module.exports = {
	name: '298_event_session_bridge',
	up: async (client) => {
		// ── 1. The bridge link on interview_events ──────────────────────
		await client.query(`
			ALTER TABLE interview_events
			ADD COLUMN IF NOT EXISTS interview_session_id INTEGER
				REFERENCES interview_sessions(id) ON DELETE SET NULL
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_events_session
			ON interview_events(interview_session_id)
			WHERE interview_session_id IS NOT NULL
		`);

		// ── 2. Gate provenance on the queue ─────────────────────────────
		await client.query(`
			ALTER TABLE diarization_jobs
			ADD COLUMN IF NOT EXISTS governing_session_id INTEGER
		`);
		await client.query(`
			ALTER TABLE diarization_jobs
			ADD COLUMN IF NOT EXISTS consent_receipt_id INTEGER
		`);

		// ── 3. Gate provenance on the durable run record ────────────────
		await client.query(`
			ALTER TABLE diarization_runs
			ADD COLUMN IF NOT EXISTS governing_session_id INTEGER
		`);
		await client.query(`
			ALTER TABLE diarization_runs
			ADD COLUMN IF NOT EXISTS consent_receipt_id INTEGER
		`);

		// ── Post-state assertions (fail loud, migration 296 pattern) ────
		// Keyed by (table, column) PAIR — governing_session_id and
		// consent_receipt_id each appear in two tables (DB-reviewer
		// condition, #1925).
		const cols = await client.query(
			`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
			 WHERE table_schema = 'public'
			   AND ((table_name = 'interview_events' AND column_name = 'interview_session_id')
			     OR (table_name = 'diarization_jobs' AND column_name IN ('governing_session_id', 'consent_receipt_id'))
			     OR (table_name = 'diarization_runs' AND column_name IN ('governing_session_id', 'consent_receipt_id')))`,
		);
		if (
			cols.rows.length !== 5 ||
			cols.rows.some((r) => r.data_type !== 'integer' || r.is_nullable !== 'YES')
		) {
			throw new Error(
				`Migration 298 post-state assertion failed: bridge columns missing, wrong type, or not nullable: ${JSON.stringify(cols.rows)}`,
			);
		}
		// The FK itself, by column, with its delete rule (DB-reviewer
		// condition): ADD COLUMN IF NOT EXISTS would silently skip the
		// REFERENCES if the column pre-existed without it, and
		// column/index assertions alone would pass over that gap.
		const fk = await client.query(
			`SELECT c.confdeltype FROM pg_constraint c
			 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
			 WHERE c.contype = 'f'
			   AND c.conrelid = 'interview_events'::regclass
			   AND a.attname = 'interview_session_id'
			   AND c.confrelid = 'interview_sessions'::regclass`,
		);
		if (fk.rows.length !== 1 || fk.rows[0].confdeltype !== 'n') {
			throw new Error(
				'Migration 298 post-state assertion failed: interview_events.interview_session_id FK to interview_sessions with ON DELETE SET NULL not present',
			);
		}
		// The provenance columns must carry NO foreign key (the Q4
		// intent, locked in): an FK on any of them fails the migration.
		const provFk = await client.query(
			`SELECT 1 FROM pg_constraint c
			 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
			 WHERE c.contype = 'f'
			   AND c.conrelid IN ('diarization_jobs'::regclass, 'diarization_runs'::regclass)
			   AND a.attname IN ('governing_session_id', 'consent_receipt_id')`,
		);
		if (provFk.rows.length !== 0) {
			throw new Error(
				'Migration 298 post-state assertion failed: a provenance column carries a foreign key (deliberately none — snapshot semantics)',
			);
		}
		const idx = await client.query(
			`SELECT indexname FROM pg_indexes
			 WHERE schemaname = 'public' AND indexname = 'idx_interview_events_session'`,
		);
		if (idx.rows.length !== 1) {
			throw new Error(
				'Migration 298 post-state assertion failed: idx_interview_events_session not present',
			);
		}

		console.log(
			'Migration 298: event→session bridge added — interview_events.interview_session_id (FK SET NULL, indexed), governing_session_id + consent_receipt_id provenance on diarization_jobs and diarization_runs; expand-only, no rows touched',
		);
	},
	down: async (client) => {
		// No-op by design: migrations never un-apply on the shared DB.
		// Reversal is a separate approved forward migration.
		console.log(
			'Migration 298 down(): no-op — reversal, if needed, is a forward migration (shared-DB rule)',
		);
	},
};
