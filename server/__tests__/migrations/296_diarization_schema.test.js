/**
 * S-D03 (#1905) — migration 296: diarization schema expansion.
 *
 * Static contract (always runs): the migration is expand-only, carries
 * exactly the Architecture §4 structures, and contains no voice-template
 * shaped column anywhere (Lex BR-4/BR-5 — the absence is a schema fact).
 *
 * Real-DB suite (gated behind MIG296_INTEGRATION_DB_URL): builds minimal
 * parent tables, seeds LEGACY recording/transcript rows, runs the real
 * up(), and proves AC-4 — pre-existing rows are byte-identical after —
 * plus CHECK enforcement and re-run idempotency. The full fresh-install
 * proof (node migrate.js from an empty DB) is recorded on #1905.
 * Example:
 *   MIG296_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd03_296_it' \
 *     npx jest server/__tests__/migrations/296_diarization_schema.test.js --forceExit
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'296_diarization_schema.js',
);

describe('296_diarization_schema migration — static contract (#1905)', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	it('is named 296 and exports up/down', () => {
		expect(migration.name).toBe('296_diarization_schema');
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	it('adds exactly the §4 columns to existing tables', () => {
		expect(src).toContain('ADD COLUMN IF NOT EXISTS speaker_number INTEGER');
		expect(src).toContain('ADD COLUMN IF NOT EXISTS diarization_status VARCHAR(20)');
		expect(src).toContain('ADD COLUMN IF NOT EXISTS diarization_updated_at TIMESTAMPTZ');
		expect(src).toContain(
			"CHECK (diarization_status IN ('pending', 'processing', 'complete', 'failed', 'unavailable'))",
		);
		expect(src).toContain('ON interview_transcripts(recording_id, speaker_number)');
	});

	it('creates exactly the five §4.2 tables', () => {
		for (const t of [
			'diarization_jobs',
			'diarization_runs',
			'recording_speaker_mappings',
			'transcript_speaker_audit',
			'diarization_metrics_daily',
		]) {
			expect(src).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
		}
	});

	it('carries the §4.2 value-set CHECKs', () => {
		expect(src).toContain(
			"CHECK (status IN ('pending', 'claimed', 'processing', 'complete', 'failed', 'cancelled'))",
		);
		expect(src).toContain("CHECK (state IN ('proposed', 'confirmed', 'corrected'))");
		expect(src).toContain("CHECK (action IN ('confirm', 'correct', 'unassign'))");
		expect(src).toContain('UNIQUE (recording_id, speaker_number)');
	});

	it('AC-2: contains no DROP and no narrowing ALTER anywhere', () => {
		expect(src).not.toMatch(/\bDROP\b/i);
		expect(src).not.toMatch(/SET NOT NULL/i);
		expect(src).not.toMatch(/ALTER COLUMN[^;]*TYPE/i);
	});

	it('AC-2 / BR-4 / BR-5: no voice-template shaped column is defined', () => {
		// No column definition whose name suggests voice-template storage,
		// and no vector/array-of-float column type anywhere.
		expect(src).not.toMatch(
			/(embedding|voiceprint|voice_print|voice_template)\s+(VECTOR|BYTEA|REAL|FLOAT|DOUBLE|JSONB|TEXT|INTEGER)/i,
		);
		expect(src).not.toMatch(/\bVECTOR\s*\(/i);
		expect(src).not.toMatch(/REAL\[\]|FLOAT\[\]/i);
	});

	it('audit actor FK is SET NULL (DB-review BLOCK fix: CASCADE would destroy the append-only trail)', () => {
		expect(src).toContain(
			'actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
		);
		expect(src).not.toMatch(/actor_user_id[^,]*ON DELETE CASCADE/);
	});

	it('CHECK guard is scoped by contype and table (migration 257 lesson)', () => {
		expect(src).toContain("contype = 'c'");
		expect(src).toContain("conrelid = 'interview_recordings'::regclass");
	});

	it('metrics table carries no recording or user linkage (HA-3 counts only)', () => {
		const start = src.indexOf('CREATE TABLE IF NOT EXISTS diarization_metrics_daily');
		const end = src.indexOf(')', src.indexOf('corrected_count', start));
		const ddl = src.slice(start, end);
		expect(ddl).toContain('date DATE PRIMARY KEY');
		expect(ddl).not.toMatch(/recording_id|user_id|REFERENCES/);
	});
});

// ---------------------------------------------------------------------------
// Real-DB suite
// ---------------------------------------------------------------------------
const DB_URL = process.env.MIG296_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('296_diarization_schema — real DB (AC-1/AC-4, #1905)', () => {
	const { Pool } = require('pg');
	let pool;
	let migration;
	const LEGACY_TEXT = 'legacy transcript segment text';

	beforeAll(async () => {
		migration = require(MIGRATION_PATH);
		pool = new Pool({ connectionString: DB_URL });
		await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
		// Minimal parents (the columns 296's FKs and ALTERs touch)
		await pool.query(`
			CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT, name TEXT);
			CREATE TABLE interview_events (id SERIAL PRIMARY KEY, recruiter_id INTEGER, candidate_id INTEGER);
			CREATE TABLE interview_rooms (id SERIAL PRIMARY KEY, room_name TEXT, livekit_room_id TEXT);
			CREATE TABLE interview_recordings (
				id SERIAL PRIMARY KEY,
				interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE,
				room_id INTEGER NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
				status VARCHAR(50) NOT NULL DEFAULT 'completed',
				created_at TIMESTAMPTZ DEFAULT NOW()
			);
			CREATE TABLE interview_transcripts (
				id SERIAL PRIMARY KEY,
				recording_id INTEGER NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
				speaker_identity VARCHAR(255) NOT NULL,
				text TEXT NOT NULL,
				start_time_ms BIGINT NOT NULL,
				end_time_ms BIGINT NOT NULL,
				created_at TIMESTAMPTZ DEFAULT NOW()
			);
		`);
		// Legacy fixture: one recording + two transcript segments
		await pool.query(`
			INSERT INTO users (id, email, name) VALUES (1, 'r@example.test', 'Rec'), (2, 'c@example.test', 'Cand');
			INSERT INTO interview_events (id, recruiter_id, candidate_id) VALUES (1, 1, 2);
			INSERT INTO interview_rooms (id, room_name, livekit_room_id) VALUES (1, 'room', 'lk-1');
			INSERT INTO interview_recordings (id, interview_event_id, room_id, status) VALUES (1, 1, 1, 'completed');
			INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			VALUES (1, 'unknown', '${LEGACY_TEXT}', 0, 1000), (1, 'unknown', 'second segment', 1000, 2000);
		`);
	});

	afterAll(async () => {
		await pool.end();
	});

	it('AC-4: legacy rows are identical before/after up(); new columns read NULL', async () => {
		const before = await pool.query(
			'SELECT id, recording_id, speaker_identity, text, start_time_ms, end_time_ms FROM interview_transcripts ORDER BY id',
		);
		const countsBefore = await pool.query(
			'SELECT (SELECT count(*)::int FROM interview_recordings) AS recs, (SELECT count(*)::int FROM interview_transcripts) AS segs',
		);

		await migration.up(pool);

		const after = await pool.query(
			'SELECT id, recording_id, speaker_identity, text, start_time_ms, end_time_ms FROM interview_transcripts ORDER BY id',
		);
		const countsAfter = await pool.query(
			'SELECT (SELECT count(*)::int FROM interview_recordings) AS recs, (SELECT count(*)::int FROM interview_transcripts) AS segs',
		);
		expect(after.rows).toEqual(before.rows);
		expect(countsAfter.rows).toEqual(countsBefore.rows);

		const legacy = await pool.query(
			'SELECT speaker_number FROM interview_transcripts ORDER BY id',
		);
		expect(legacy.rows).toEqual([{ speaker_number: null }, { speaker_number: null }]);
		const rec = await pool.query(
			'SELECT diarization_status, diarization_updated_at FROM interview_recordings WHERE id = 1',
		);
		expect(rec.rows).toEqual([
			{ diarization_status: null, diarization_updated_at: null },
		]);
	});

	it('AC-1: the five tables exist with the diarization_status CHECK enforced', async () => {
		const tables = await pool.query(
			`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
			   AND table_name IN ('diarization_jobs','diarization_runs','recording_speaker_mappings','transcript_speaker_audit','diarization_metrics_daily')
			 ORDER BY table_name`,
		);
		expect(tables.rows.map((r) => r.table_name)).toEqual([
			'diarization_jobs',
			'diarization_metrics_daily',
			'diarization_runs',
			'recording_speaker_mappings',
			'transcript_speaker_audit',
		]);
		await expect(
			pool.query(
				"UPDATE interview_recordings SET diarization_status = 'bogus' WHERE id = 1",
			),
		).rejects.toThrow(/chk_interview_recordings_diarization_status/);
		await pool.query(
			"UPDATE interview_recordings SET diarization_status = 'pending' WHERE id = 1",
		);
		// Audit actor is nullable + SET NULL: an audit row survives its
		// actor (DB-review BLOCK fix on #1905)
		const actor = await pool.query(
			`SELECT is_nullable FROM information_schema.columns
			 WHERE table_name = 'transcript_speaker_audit' AND column_name = 'actor_user_id'`,
		);
		expect(actor.rows).toEqual([{ is_nullable: 'YES' }]);
		await pool.query(
			`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, actor_user_id, action)
			 VALUES (1, 0, NULL, 'confirm')`,
		);
	});

	it('re-running up() is a no-op (idempotent)', async () => {
		await migration.up(pool);
		const rec = await pool.query(
			'SELECT diarization_status FROM interview_recordings WHERE id = 1',
		);
		expect(rec.rows).toEqual([{ diarization_status: 'pending' }]);
	});
});
