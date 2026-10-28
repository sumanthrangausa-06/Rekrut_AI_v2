// =============================================================================
// Migration 296: Speaker-labelled transcripts (diarization) schema — S-D03
// =============================================================================
//
// Epic #1900, story #1905 (S-D03). Design: Rex, Architecture §4 / §3.3 /
// ADR-D02 / ADR-D03 (docs/sdlc/rekrut-ai-v2/03-solutioning/
// speaker-labelled-transcripts/architecture.md). Lex position BR-4/BR-5.
//
// WHAT (expand-only — nothing renamed, narrowed, backfilled, or removed):
//   1. interview_transcripts.speaker_number INTEGER NULL
//      (NULL = unlabelled: legacy rows, partial coverage, consent-blocked,
//      failed). Plus index (recording_id, speaker_number).
//   2. interview_recordings.diarization_status VARCHAR(20) NULL with a
//      CHECK over ('pending','processing','complete','failed','unavailable')
//      + diarization_updated_at TIMESTAMPTZ NULL. NULL = feature never
//      queued (all pre-feature recordings render exactly as today).
//   3. diarization_jobs — the queue (observer_jobs sibling, §3.3).
//   4. diarization_runs — the engine's original output, retained verbatim
//      for audit (turns + versions + proposal). Turns and counts only.
//   5. recording_speaker_mappings — live speaker-number → participant map.
//   6. transcript_speaker_audit — append-only correction trail.
//   7. diarization_metrics_daily — counts-only daily aggregate; no
//      recording or user linkage of any kind (the only diarization
//      artefact that legitimately survives erasure, §4.2 / HA-3).
//
// PRIVACY — A SCHEMA FACT, NOT A CONVENTION (Lex BR-4 / BR-5):
//   Speaker voice templates exist only in the diarization worker's
//   process memory for one job's duration. There is deliberately NO
//   column anywhere in this migration that could hold one — no
//   voice-print, template, or vector-shaped storage — and no table
//   that could serve as a cross-recording speaker store. A reviewer
//   can verify the absence from this file alone (§4.2).
//
// EXECUTION GATE (§4.4): this migration is designed and proven on the
// local rig only in S-D03. It executes on the shared Neon database
// only after the Nov 1 unfreeze, in dev → staging → main promotion
// order, sequenced by Lead. This file authorizes no live execution.
//
// Safety: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
// CREATE INDEX IF NOT EXISTS throughout; the one CHECK is added under
// a pg_constraint existence guard by its exact name, so a re-run is a
// no-op. Post-state assertions (migration 295 pattern) fail the
// migration loudly rather than recording success over a wrong schema.
//
// down(): migrations never un-apply on the shared database (rollback
// is by forward fix only), so down() is intentionally a no-op that
// logs — reversal, if ever needed, is its own approved forward
// migration (the deferred contract phase in §4.4).
// =============================================================================

const DIARIZATION_TABLES = [
	'diarization_jobs',
	'diarization_runs',
	'recording_speaker_mappings',
	'transcript_speaker_audit',
	'diarization_metrics_daily',
];

module.exports = {
	name: '296_diarization_schema',
	up: async (client) => {
		// ── 1. interview_transcripts.speaker_number ─────────────────────
		await client.query(`
			ALTER TABLE interview_transcripts
			ADD COLUMN IF NOT EXISTS speaker_number INTEGER
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_interview_transcripts_recording_speaker
			ON interview_transcripts(recording_id, speaker_number)
		`);

		// ── 2. interview_recordings diarization state ───────────────────
		await client.query(`
			ALTER TABLE interview_recordings
			ADD COLUMN IF NOT EXISTS diarization_status VARCHAR(20)
		`);
		await client.query(`
			ALTER TABLE interview_recordings
			ADD COLUMN IF NOT EXISTS diarization_updated_at TIMESTAMPTZ
		`);
		await client.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'chk_interview_recordings_diarization_status'
				) THEN
					ALTER TABLE interview_recordings
					ADD CONSTRAINT chk_interview_recordings_diarization_status
					CHECK (diarization_status IN ('pending', 'processing', 'complete', 'failed', 'unavailable'));
				END IF;
			END
			$$
		`);

		// ── 3. diarization_jobs (observer_jobs sibling, §3.3) ───────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS diarization_jobs (
				id SERIAL PRIMARY KEY,
				recording_id INTEGER NOT NULL
					REFERENCES interview_recordings(id) ON DELETE CASCADE,
				status VARCHAR(20) NOT NULL DEFAULT 'pending'
					CHECK (status IN ('pending', 'claimed', 'processing', 'complete', 'failed', 'cancelled')),
				cancel_reason TEXT,
				worker_id VARCHAR(255),
				claimed_at TIMESTAMPTZ,
				last_heartbeat TIMESTAMPTZ,
				attempt_count INTEGER NOT NULL DEFAULT 0,
				error_class VARCHAR(50),
				error_message TEXT,
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		// Claim: pending jobs in creation order (migration 255 shapes)
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_diarization_jobs_claim
			ON diarization_jobs(status, created_at) WHERE status = 'pending'
		`);
		// Sweeper: active jobs with dead heartbeats
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_diarization_jobs_heartbeat
			ON diarization_jobs(last_heartbeat)
			WHERE status IN ('claimed', 'processing')
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_diarization_jobs_recording
			ON diarization_jobs(recording_id)
		`);

		// ── 4. diarization_runs (original output, verbatim) ─────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS diarization_runs (
				id SERIAL PRIMARY KEY,
				recording_id INTEGER NOT NULL
					REFERENCES interview_recordings(id) ON DELETE CASCADE,
				job_id INTEGER REFERENCES diarization_jobs(id),
				engine_package VARCHAR(100),
				sdk_version VARCHAR(20),
				model_version VARCHAR(20),
				speaker_count INTEGER,
				turns JSONB,
				proposed_mapping JSONB,
				coverage_end_ms BIGINT,
				created_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_diarization_runs_recording
			ON diarization_runs(recording_id)
		`);

		// ── 5. recording_speaker_mappings (live number → name map) ──────
		// participant_user_id / updated_by use ON DELETE SET NULL so a
		// user's erasure is never blocked by a mapping row (BR-13); the
		// row itself dies with its recording (E-3 family).
		await client.query(`
			CREATE TABLE IF NOT EXISTS recording_speaker_mappings (
				id SERIAL PRIMARY KEY,
				recording_id INTEGER NOT NULL
					REFERENCES interview_recordings(id) ON DELETE CASCADE,
				speaker_number INTEGER NOT NULL,
				participant_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				participant_role VARCHAR(20)
					CHECK (participant_role IN ('candidate', 'interviewer')),
				state VARCHAR(20) NOT NULL DEFAULT 'proposed'
					CHECK (state IN ('proposed', 'confirmed', 'corrected')),
				updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE (recording_id, speaker_number)
			)
		`);

		// ── 6. transcript_speaker_audit (append-only) ───────────────────
		// actor_user_id is ON DELETE CASCADE for the same BR-13 reason:
		// an actor's erasure must not be blocked; a recording's audit
		// rows already die with the recording itself.
		await client.query(`
			CREATE TABLE IF NOT EXISTS transcript_speaker_audit (
				id SERIAL PRIMARY KEY,
				recording_id INTEGER NOT NULL
					REFERENCES interview_recordings(id) ON DELETE CASCADE,
				speaker_number INTEGER NOT NULL,
				from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				action VARCHAR(20) NOT NULL
					CHECK (action IN ('confirm', 'correct', 'unassign')),
				created_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_transcript_speaker_audit_recording
			ON transcript_speaker_audit(recording_id)
		`);

		// ── 7. diarization_metrics_daily (counts only, no linkage) ──────
		await client.query(`
			CREATE TABLE IF NOT EXISTS diarization_metrics_daily (
				date DATE PRIMARY KEY,
				labelled_count INTEGER NOT NULL DEFAULT 0,
				corrected_count INTEGER NOT NULL DEFAULT 0
			)
		`);

		// ── Post-state assertions (fail loud, migration 295 pattern) ────
		const cols = await client.query(
			`SELECT table_name, column_name FROM information_schema.columns
			 WHERE table_schema = 'public'
			   AND ((table_name = 'interview_transcripts' AND column_name = 'speaker_number')
			     OR (table_name = 'interview_recordings' AND column_name IN ('diarization_status', 'diarization_updated_at')))`,
		);
		if (cols.rows.length !== 3) {
			throw new Error(
				`Migration 296 post-state assertion failed: expected 3 new columns on existing tables, found ${cols.rows.length}`,
			);
		}
		const tables = await client.query(
			`SELECT table_name FROM information_schema.tables
			 WHERE table_schema = 'public' AND table_name = ANY($1)`,
			[DIARIZATION_TABLES],
		);
		if (tables.rows.length !== DIARIZATION_TABLES.length) {
			throw new Error(
				`Migration 296 post-state assertion failed: expected ${DIARIZATION_TABLES.length} new tables, found ${tables.rows.length}`,
			);
		}
		// BR-4/BR-5 self-check: no column in any new table may be shaped
		// to hold a voice template.
		const shaped = await client.query(
			`SELECT table_name, column_name FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = ANY($1)
			   AND (column_name ILIKE '%embedding%' OR column_name ILIKE '%voiceprint%'
			     OR column_name ILIKE '%voice_print%' OR column_name ILIKE '%template%')`,
			[DIARIZATION_TABLES],
		);
		if (shaped.rows.length !== 0) {
			throw new Error(
				'Migration 296 post-state assertion failed: a new table carries a voice-template-shaped column (BR-4/BR-5 violation)',
			);
		}

		console.log(
			'Migration 296: diarization schema added — speaker_number, diarization_status (+CHECK), diarization_updated_at, 5 new tables; expand-only, no existing rows touched, no voice-template storage (BR-4/BR-5)',
		);
	},
	down: async (client) => {
		// No-op by design: migrations never un-apply on the shared DB.
		// Reversal is a separate approved forward migration (§4.4).
		console.log(
			'Migration 296 down(): no-op — reversal, if needed, is a forward migration (shared-DB rule)',
		);
	},
};
