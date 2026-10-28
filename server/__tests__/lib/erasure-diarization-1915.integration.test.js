/**
 * #1915 (S-D13) — Erasure integration for diarization artefacts (JT-D7).
 *
 * Quinn-style user-journey suite on the real rig (HL-003): a candidate
 * exercises erasure and EVERYTHING diarization created about their
 * interviews dies with the interviews — nothing labelled survives
 * anywhere (PRD FR-D18, Architecture §6.4, Lex BR-13).
 *
 * Real erasePersonalData() (lib/erasureService.js) inside a real
 * BEGIN…COMMIT transaction, real Postgres seeded directly, resulting
 * state read back from the DB, and the transcript READ path exercised
 * through the real recordings router over HTTP (supertest) before and
 * after erasure. Synthetic fixtures only; no real recordings.
 *
 * Scenarios:
 *  - Event-linked diarized recording (interview_events.candidate_id).
 *  - Session-linked diarized recording (GAP-A branch: migration 130's
 *    XOR CHECK gives it interview_event_id IS NULL, so the event join
 *    alone can never reach it).
 *  - A control diarized recording belonging to ANOTHER candidate —
 *    must survive untouched.
 *  - diarization_metrics_daily (counts-only, no recording/user
 *    linkage, AC-3) — must be byte-identical after erasure.
 *
 * Run:
 *   SD13_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd13_e2e' \
 *     npx jest server/__tests__/lib/erasure-diarization-1915.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.SD13_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_CAND = 191501;
const U_REC = 191502;
const U_OTHER = 191503;
const C_ID = 19151;
const METRICS_DATE = '2026-10-27';

let app;
let request;
let generateToken;
let erasePersonalData;
let seedPool;

const R = {};

const recToken = () =>
	generateToken({ id: U_REC, email: 'rec1915@test.local', role: 'recruiter' });

async function seedDiarizedRecording({ eventId = null, sessionId = null }) {
	const q = (sql, params) => seedPool.query(sql, params);
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, interview_session_id, status, duration_seconds, storage_path, diarization_status, retention_expires_at)
		 VALUES ($1, $2, 'completed', 3600, NULL, 'complete', NOW() + INTERVAL '90 days') RETURNING id`,
		[eventId, sessionId],
	);
	const recordingId = rec.rows[0].id;
	for (const [speaker, text, start, end] of [
		[0, 'Synthetic question one.', 0, 4000],
		[1, 'Synthetic answer one.', 4000, 9000],
	]) {
		await q(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
			 VALUES ($1, 'unknown', $2, $3, $4, $5)`,
			[recordingId, text, start, end, speaker],
		);
	}
	const job = await q(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[recordingId],
	);
	await q(
		`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2,
		   '[{"speaker":0,"start_s":0,"end_s":4},{"speaker":1,"start_s":4,"end_s":9}]'::jsonb, 9000)`,
		[recordingId, job.rows[0].id],
	);
	await q(
		`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, 0, $2, 'interviewer', 'corrected'), ($1, 1, $3, 'candidate', 'corrected')`,
		[recordingId, U_REC, eventId ? U_CAND : U_OTHER],
	);
	await q(
		`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
		 VALUES ($1, 0, $2, $3, $2, 'correct')`,
		[recordingId, U_REC, U_CAND],
	);
	return recordingId;
}

async function countArtefacts(recordingId) {
	const counts = {};
	for (const table of [
		'diarization_jobs',
		'diarization_runs',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'interview_transcripts',
	]) {
		const { rows } = await seedPool.query(
			`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`,
			[recordingId],
		);
		counts[table] = rows[0].n;
	}
	return counts;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_CAND, U_REC, U_OTHER];
	// Wipe any prior run's fixtures (idempotent re-runs on the same DB).
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})
		OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = ANY($2::int[]))`;
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, userIds]);
	}
	await q(`DELETE FROM interview_recordings WHERE id IN (${recScope})`, [U_REC, userIds]);
	await q(
		`DELETE FROM interview_sessions WHERE candidate_id = ANY($1::int[])`,
		[userIds],
	);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`, [
		U_REC,
		userIds,
	]);
	await q(`DELETE FROM diarization_metrics_daily WHERE date = $1`, [METRICS_DATE]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);

	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D13 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'cand1915@test.local', 'Cand 1915', 'candidate', NULL),
		   ($2, 'rec1915@test.local', 'Rec 1915', 'recruiter', $4),
		   ($3, 'other1915@test.local', 'Other 1915', 'candidate', NULL)`,
		[U_CAND, U_REC, U_OTHER, C_ID],
	);

	// Event-linked diarized recording for the erasing candidate.
	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	R.eventLinked = await seedDiarizedRecording({ eventId: ev.rows[0].id });

	// Session-linked diarized recording for the erasing candidate
	// (GAP-A branch: interview_event_id IS NULL by the XOR CHECK).
	const sess = await q(
		`INSERT INTO interview_sessions (type, candidate_id, company_id) VALUES ('human', $1, $2) RETURNING id`,
		[U_CAND, C_ID],
	);
	R.sessionLinked = await seedDiarizedRecording({ sessionId: sess.rows[0].id });

	// Control: another candidate's diarized recording — must survive.
	const evOther = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
		 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
		[U_REC, U_OTHER],
	);
	R.control = await seedDiarizedRecording({ eventId: evOther.rows[0].id });

	// Counts-only aggregate (AC-3): no recording/user linkage exists in
	// this table; erasure must leave it byte-identical.
	await q(
		`INSERT INTO diarization_metrics_daily (date, labelled_count, corrected_count) VALUES ($1, 3, 1)`,
		[METRICS_DATE],
	);
}

async function getTranscript(recordingId) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/transcript`)
		.set('Authorization', `Bearer ${recToken()}`);
}

describeIfDb('#1915 S-D13 diarization erasure (JT-D7, realdb journey)', () => {
	beforeAll(async () => {
		// Env BEFORE lib/db's pool and the router load — the 1911 pattern.
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

		({ erasePersonalData } = require('../../../lib/erasureService'));

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews/recordings', recordingsRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('JT-D7 journey: erasure removes every diarization artefact for BOTH recording branches; metrics + control untouched; reads return absence', async () => {
		// Seed sanity: both target recordings are fully diarized, and the
		// label read composes names before erasure (the user's starting
		// state — labels exist and are reachable).
		for (const id of [R.eventLinked, R.sessionLinked, R.control]) {
			expect(await countArtefacts(id)).toEqual({
				diarization_jobs: 1,
				diarization_runs: 1,
				recording_speaker_mappings: 2,
				transcript_speaker_audit: 1,
				interview_transcripts: 2,
			});
		}
		const before = await getTranscript(R.eventLinked);
		expect(before.status).toBe(200);
		expect(before.body.transcript.diarization.status).toBe('complete');
		expect(JSON.stringify(before.body)).toContain('Cand 1915');

		const metricsBefore = await seedPool.query(
			`SELECT date, labelled_count, corrected_count FROM diarization_metrics_daily WHERE date = $1`,
			[METRICS_DATE],
		);
		expect(metricsBefore.rows).toHaveLength(1);

		// The user journey's act: the candidate's erasure runs, in the
		// production caller shape (one BEGIN…COMMIT transaction client).
		const client = new Client({ connectionString: DB_URL });
		await client.connect();
		let result;
		try {
			await client.query('BEGIN');
			result = await erasePersonalData(U_CAND, { client });
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			await client.end();
		}

		// AC-1: the audit return discloses the diarization counts.
		expect(result.diarizationJobsDeleted).toBe(2);
		expect(result.diarizationRunsDeleted).toBe(2);
		expect(result.speakerMappingsDeleted).toBe(4);
		expect(result.speakerAuditDeleted).toBe(2);
		expect(result.transcriptsDeleted).toBe(4);

		// AC-1 + AC-2 sweep: zero diarization artefacts remain for either
		// of the candidate's recordings — event-linked AND session-linked.
		for (const id of [R.eventLinked, R.sessionLinked]) {
			expect(await countArtefacts(id)).toEqual({
				diarization_jobs: 0,
				diarization_runs: 0,
				recording_speaker_mappings: 0,
				transcript_speaker_audit: 0,
				interview_transcripts: 0,
			});
		}

		// Control: the other candidate's artefacts are fully intact.
		expect(await countArtefacts(R.control)).toEqual({
			diarization_jobs: 1,
			diarization_runs: 1,
			recording_speaker_mappings: 2,
			transcript_speaker_audit: 1,
			interview_transcripts: 2,
		});

		// AC-3: the counts-only daily aggregate is untouched.
		const metricsAfter = await seedPool.query(
			`SELECT date, labelled_count, corrected_count FROM diarization_metrics_daily WHERE date = $1`,
			[METRICS_DATE],
		);
		expect(metricsAfter.rows).toEqual(metricsBefore.rows);

		// AC-2 read-back: the transcript/label read for an erased
		// recording returns absence consistent with [purged] behaviour —
		// no segments, no label data (empty speakers / null mapping
		// state if the status block is emitted), no names anywhere.
		const after = await getTranscript(R.eventLinked);
		expect([200, 403, 404]).toContain(after.status);
		if (after.status === 200) {
			expect(after.body.transcript.segment_count).toBe(0);
			expect(after.body.transcript.segments).toEqual([]);
			// Label absence: the S-D09 composition may still emit the
			// status block for a post-feature recording, but it must
			// carry NO label data — no speakers, no mapping state, no
			// corrector (the underlying rows no longer exist).
			const d = after.body.transcript.diarization;
			if (d) {
				expect(d.speakers).toEqual([]);
				expect(d.mapping_state).toBeNull();
				expect(d.corrected_by).toBeNull();
			}
		}
		expect(JSON.stringify(after.body)).not.toContain('Cand 1915');
		expect(JSON.stringify(after.body)).not.toContain('Speaker');
	});
});
