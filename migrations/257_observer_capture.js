// =============================================================================
// Migration 257: Gate A dormant-capture substrate (S-085, #787)
// =============================================================================
//
// Rex v2 design §9 (gate-a-dormant-capture-design.md, PR #798). This migration
// creates the persistence substrate for flag-gated observer audio capture.
// The capture flag (OBSERVER_AUDIO_CAPTURE_ENABLED) defaults OFF; with the
// flag off the worker subscribes to nothing and none of these tables are
// written. Activation additionally requires a consent artefact this build
// deliberately does NOT ship (counsel owns the wording, C-04) — the schema
// makes activation *possible later*, never reachable by this migration.
//
// Changes:
//   1. recording_objects: object_type CHECK widened with 'observer_audio'
//      (constraint looked up by name via pg_constraint, contype='c' —
//      #1155: information_schema surfaces PG18 NOT NULL constraints as
//      pseudo-CHECKs whose names can match the LIKE fragment)
//      + registration_state column ('pending'|'confirmed',
//      default 'confirmed' — legacy rows are born confirmed).
//   2. data_retention_policies: ('observer_audio', 30 days, auto_delete)
//      — D-1: captured audio is recording-class data with a 30-day
//      sub-policy (Sumanth's approval, 2026-10-13).
//   3. observer_audio_chunks: one row per persisted 30s chunk; the storage
//      object_key lives here AND in recording_objects (registry).
//   4. observer_speech_measurements: one row per session; the measurement
//      set exists ONLY inside the DEK-encrypted envelope (BYTEA). Coarse
//      columns carry no per-measurement data (design §9, privacy delta
//      condition — no plaintext measurement column may be added).
//   5. observer_capture_outcomes: counts-only outcome row per session that
//      ENTERED capturing (dormant sessions write no row).
//   6. observer_cohort_allowlist: D-2 — the named employer allow-list IS
//      the cohort cap (no numeric cap exists by design).
//   7. observer_cohort_membership: append-only gate-decision snapshots.
//      D-2 errata (recorded at STOP 1 on #787): surrogate SERIAL PK —
//      design §9's session-id PK contradicts §3.3's append-only
//      corrections; the capture decision reads the LATEST row per session.
//   8. observer_activation_enablements: activation evidence trail. All six
//      evidence refs NOT NULL. NO rows are inserted by this migration or
//      by the build — a row can only be created deliberately at a future
//      activation gate.
//   9. observer_jobs.origin_env: env-identity stamp written at job
//      creation (design D-1). Default 'unknown' = capture-ineligible.
//  10. pending_storage_deletions.source_family (P-19): lets erasure
//      verification count observer-audio deletions distinctly from the
//      2026-09 legacy 'file' family. Default 'file' preserves every
//      existing writer.
//  11. consent_texts / consent_receipts CHECKs widened with
//      'observer_capture' so the type exists in the schema. NO
//      consent_texts row is inserted — without an artefact, no receipt
//      can exist and activation consent can never be satisfied.
//
// Safety: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
// constraint drop-by-name (idempotent, migration-254 pattern).
// =============================================================================

async function dropCheckByName(client, table, nameFragment) {
	await client.query(`
		DO $$
		DECLARE
			chk_name TEXT;
		BEGIN
			SELECT con.conname INTO chk_name
			FROM pg_constraint con
			JOIN pg_class rel ON rel.oid = con.conrelid
			WHERE rel.relname = '${table}'
				AND con.contype = 'c'
				AND con.conname LIKE '%${nameFragment}%'
			LIMIT 1;

			IF chk_name IS NOT NULL THEN
				EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', chk_name);
			END IF;
		END
		$$;
	`);
}

async function up(client) {
	// ── 1. recording_objects: widen object_type + registration_state ──────
	await dropCheckByName(client, 'recording_objects', 'object_type');
	await client.query(`
		ALTER TABLE recording_objects
		ADD CONSTRAINT recording_objects_object_type_check
		CHECK (object_type IN ('frame', 'recording', 'observer_audio'))
	`);
	await client.query(`
		ALTER TABLE recording_objects
		ADD COLUMN IF NOT EXISTS registration_state TEXT NOT NULL DEFAULT 'confirmed'
		CHECK (registration_state IN ('pending', 'confirmed'))
	`);

	// ── 2. Retention policy row (D-1: 30-day recording-class sub-policy) ──
	await client.query(`
		INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, description)
		VALUES ('observer_audio', 30, true, 'Delete observer-captured audio 30 days post-capture (Gate A D-1 recording-class sub-policy, S-085)')
		ON CONFLICT (data_type) DO NOTHING
	`);

	// ── 3. observer_audio_chunks ──────────────────────────────────────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_audio_chunks (
			id SERIAL PRIMARY KEY,
			interview_session_id INTEGER NOT NULL
				REFERENCES interview_sessions(id) ON DELETE CASCADE,
			candidate_id INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			object_key TEXT NOT NULL UNIQUE,
			byte_size INTEGER,
			sample_rate INTEGER NOT NULL DEFAULT 48000,
			captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			is_test BOOLEAN NOT NULL DEFAULT false,
			UNIQUE (interview_session_id, chunk_index)
		)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_audio_chunks_candidate
		ON observer_audio_chunks(candidate_id)
	`);
	// (No session index: UNIQUE (interview_session_id, chunk_index) already
	// serves session-ordered reads via its left prefix — DB review m3.)

	// ── 4. observer_speech_measurements (envelope-only) ───────────────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_speech_measurements (
			id SERIAL PRIMARY KEY,
			interview_session_id INTEGER NOT NULL UNIQUE
				REFERENCES interview_sessions(id) ON DELETE CASCADE,
			candidate_id INTEGER NOT NULL,
			measurements_envelope BYTEA NOT NULL,
			method_version INTEGER NOT NULL DEFAULT 1,
			state TEXT NOT NULL DEFAULT 'recorded',
			is_test BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_speech_measurements_candidate
		ON observer_speech_measurements(candidate_id)
	`);

	// ── 5. observer_capture_outcomes (counts only) ────────────────────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_capture_outcomes (
			interview_session_id INTEGER PRIMARY KEY
				REFERENCES interview_sessions(id) ON DELETE CASCADE,
			candidate_id INTEGER NOT NULL,
			scope TEXT NOT NULL CHECK (scope IN ('test', 'activation')),
			is_test BOOLEAN NOT NULL DEFAULT false,
			cohort_allowlist_version INTEGER,
			chunks_persisted INTEGER NOT NULL DEFAULT 0,
			chunks_dropped INTEGER NOT NULL DEFAULT 0,
			audio_seconds_captured NUMERIC NOT NULL DEFAULT 0,
			capture_gap_ratio NUMERIC,
			stop_reason TEXT NOT NULL CHECK (stop_reason IN (
				'session_end', 'flag_off', 'consent_withdrawn',
				'consent_check_failed', 'storage_failed', 'dek_unavailable',
				'role_flip', 'job_gone', 'concurrency_cap', 'worker_shutdown'
			)),
			started_at TIMESTAMPTZ NOT NULL,
			stopped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_capture_outcomes_candidate
		ON observer_capture_outcomes(candidate_id)
	`);

	// ── 6. observer_cohort_allowlist (D-2: the list IS the cap) ──────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_cohort_allowlist (
			company_id INTEGER PRIMARY KEY,
			company_name TEXT,
			allowlist_version INTEGER NOT NULL DEFAULT 1,
			added_by TEXT NOT NULL,
			added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			notes TEXT
		)
	`);

	// ── 7. observer_cohort_membership (append-only; D-2 errata PK) ───────
	// No FK on interview_session_id: rows are gate-decision evidence,
	// including corrections; the evidence trail must not cascade away.
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_cohort_membership (
			id SERIAL PRIMARY KEY,
			interview_session_id INTEGER NOT NULL,
			company_id INTEGER,
			is_member BOOLEAN NOT NULL,
			allowlist_version INTEGER,
			source TEXT NOT NULL DEFAULT 'allowlist'
				CHECK (source IN ('allowlist', 'test_harness', 'manual')),
			recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_observer_cohort_membership_session
		ON observer_cohort_membership(interview_session_id, recorded_at DESC)
	`);

	// ── 8. observer_activation_enablements (NO rows inserted) ─────────────
	// §9 shape (DB review M1): ONE current row PER EMPLOYER (company_id is
	// the PK) carrying the six L-ACT-04 evidence refs. The gate's
	// post-enablement consent rule (§3.2(d)) is evaluated per employer —
	// a global-latest row would make that check unimplementable.
	await client.query(`
		CREATE TABLE IF NOT EXISTS observer_activation_enablements (
			company_id INTEGER PRIMARY KEY,
			enabled_at TIMESTAMPTZ NOT NULL,
			enabled_by TEXT NOT NULL,
			counsel_ref TEXT NOT NULL,
			lex_activation_ref TEXT NOT NULL,
			quinn_validation_ref TEXT NOT NULL,
			policy777_ref TEXT NOT NULL,
			bipa_schedule_ref TEXT NOT NULL,
			sumanth_activation_ref TEXT NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`);

	// ── 9. observer_jobs.origin_env stamp ─────────────────────────────────
	await client.query(`
		ALTER TABLE observer_jobs
		ADD COLUMN IF NOT EXISTS origin_env TEXT NOT NULL DEFAULT 'unknown'
	`);

	// ── 10. pending_storage_deletions.source_family (P-19) ────────────────
	await client.query(`
		ALTER TABLE pending_storage_deletions
		ADD COLUMN IF NOT EXISTS source_family TEXT NOT NULL DEFAULT 'file'
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_pending_storage_deletions_family
		ON pending_storage_deletions(source_family, status)
	`);

	// ── 11. consent CHECKs: 'observer_capture' type exists; no artefact ──
	await dropCheckByName(client, 'consent_texts', 'consent_type');
	await client.query(`
		ALTER TABLE consent_texts
		ADD CONSTRAINT consent_texts_consent_type_check
		CHECK (consent_type IN ('recording', 'biometric', 'id_verification', 'biometric_practice', 'observer_capture'))
	`);
	await dropCheckByName(client, 'consent_receipts', 'consent_type');
	await client.query(`
		ALTER TABLE consent_receipts
		ADD CONSTRAINT consent_receipts_consent_type_check
		CHECK (consent_type IN ('recording', 'biometric', 'id_verification', 'biometric_practice', 'observer_capture'))
	`);

	// ── 12. Reconciler scan index (DB review M4) ──────────────────────────
	// The 60 s reconciler scans recording_objects for pending observer
	// intents; without this partial index that is a seq scan of a registry
	// that also accumulates frame/recording rows.
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_recording_objects_observer_pending
		ON recording_objects(created_at)
		WHERE object_type = 'observer_audio' AND registration_state = 'pending' AND deleted_at IS NULL
	`);

	console.log('Migration 257: Gate A dormant-capture substrate done');
}

async function down(client) {
	await client.query(`DROP TABLE IF EXISTS observer_audio_chunks`);
	await client.query(`DROP TABLE IF EXISTS observer_speech_measurements`);
	await client.query(`DROP TABLE IF EXISTS observer_capture_outcomes`);
	await client.query(`DROP TABLE IF EXISTS observer_cohort_allowlist`);
	await client.query(`DROP TABLE IF EXISTS observer_cohort_membership`);
	await client.query(`DROP TABLE IF EXISTS observer_activation_enablements`);
	await client.query(`DROP INDEX IF EXISTS idx_recording_objects_observer_pending`);
	// Per design §9's down() note (DB review M3): the widened CHECK
	// constraints AND the additive columns registration_state /
	// source_family / origin_env are LEFT IN PLACE on rollback —
	// narrowing a widened CHECK or dropping a defaulted column while
	// rows use the new values would fail, and the additions are harmless
	// dormant (migration-254 precedent). The ('observer_audio', 30)
	// policy row is likewise left behind; re-running up() is
	// ON CONFLICT DO NOTHING.
}

module.exports = { up, down };
