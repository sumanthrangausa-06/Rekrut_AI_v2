/**
 * #1913 (S-D11) — Candidate-view parity: the candidate who owns a
 * recording reads the IDENTICAL composed transcript artefact as the
 * recruiter (AC-1), receives no recruiter-gated fields and no mapping
 * internals (AC-2/AC-3), and the corrector-only /speakers boundary
 * holds from a candidate token while a recruiter passes (Lead's
 * pre-merge two-account proof). Non-owning candidates get nothing.
 *
 * Quinn journey suite on the real rig (HL-003): REAL recordings
 * router, REAL lib/db, REAL auth over HTTP via supertest, real
 * Postgres seeded directly. Synthetic fixtures only.
 *
 * Run:
 *   SD11_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd11_fresh' \
 *     npx jest server/__tests__/routes/recordings-candidate-parity-1913.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD11_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191301;
const U_CAND = 191302;
const U_OUT = 191303;
const U_NAMELESS = 191304;
const C_ID = 19131;

let app;
let request;
let generateToken;
let seedPool;
let R_ID;
let SEG_ID;

function tokenFor(id, email, role) {
	return generateToken({ id, email, role });
}
const recToken = () => tokenFor(U_REC, 'rec1913@test.local', 'recruiter');
const candToken = () => tokenFor(U_CAND, 'cand1913@test.local', 'candidate');
const outToken = () => tokenFor(U_OUT, 'out1913@test.local', 'candidate');

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_OUT, U_NAMELESS];
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})`;
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'recording_consent',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, U_CAND]);
	}
	await q(`DELETE FROM interview_recordings WHERE interview_event_id IN (${eventScope})`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM interview_rooms WHERE interview_event_id IN (${eventScope})`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D11 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1913@test.local', 'Rec 1913', 'recruiter', $5),
		   ($2, 'cand1913@test.local', 'Cand 1913', 'candidate', NULL),
		   ($3, 'out1913@test.local', 'Out 1913', 'candidate', NULL),
		   ($4, 'nameless1913@test.local', NULL, 'candidate', NULL)`,
		[U_REC, U_CAND, U_OUT, U_NAMELESS, C_ID],
	);

	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1, $2, '{}'::int[], 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	const eventId = ev.rows[0].id;
	const room = await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1, $2, $3, 'closed') RETURNING id`,
		[eventId, `room-${eventId}`, `lk-${eventId}`],
	);
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, $2, 'completed', 3600, 'stub', 'complete') RETURNING id`,
		[eventId, room.rows[0].id],
	);
	R_ID = rec.rows[0].id;

	const s0 = await q(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
		 VALUES ($1, 'unknown', 'Tell me about yourself.', 0, 4000, 0) RETURNING id`,
		[R_ID],
	);
	SEG_ID = s0.rows[0].id;
	await q(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
		 VALUES ($1, 'unknown', 'I led a team of five.', 4000, 9000, 1)`,
		[R_ID],
	);
	await q(
		`INSERT INTO recording_speaker_mappings
		   (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, 0, $2, 'interviewer', 'corrected'),
		        ($1, 1, $3, 'candidate', 'confirmed')`,
		[R_ID, U_REC, U_CAND],
	);
	await q(
		`INSERT INTO transcript_speaker_audit
		   (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action, created_at)
		 VALUES ($1, 0, $2, $3, $4, 'correct', '2026-10-20 15:04:05+00')`,
		[R_ID, U_CAND, U_REC, U_REC],
	);
	// A recruiter highlight on segment 0 — recruiter-only content.
	await q(
		`INSERT INTO transcript_highlights (transcript_id, user_id, note, highlight_timestamp_ms)
		 VALUES ($1, $2, 'Recruiter-only note', 1000)`,
		[SEG_ID, U_REC],
	);
	// Consent: the candidate (named) and a nameless consenter whose
	// detail payload carries an email — the client must never render
	// that email to the candidate (privacy condition, #1913 STOP 1).
	await q(
		`INSERT INTO recording_consent (recording_id, user_id) VALUES ($1, $2), ($1, $3)`,
		[R_ID, U_CAND, U_NAMELESS],
	);
}

async function get(path, token) {
	return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

describeIfDb('#1913 S-D11 candidate-view parity (realdb journey)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

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

	test('AC-1: candidate transcript is identical to the recruiter transcript (labels + diarization block)', async () => {
		const recRes = await get(`/api/interviews/recordings/${R_ID}/transcript`, recToken());
		const candRes = await get(`/api/interviews/recordings/${R_ID}/transcript`, candToken());
		expect(recRes.status).toBe(200);
		expect(candRes.status).toBe(200);

		expect(candRes.body.transcript.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1913',
			'Candidate — Cand 1913',
		]);
		expect(candRes.body.transcript.segments.map((s) => s.speaker_identity)).toEqual(
			recRes.body.transcript.segments.map((s) => s.speaker_identity),
		);
		expect(candRes.body.transcript.diarization).toEqual(recRes.body.transcript.diarization);
		expect(candRes.body.transcript.diarization).toEqual({
			status: 'complete',
			mapping_state: 'corrected',
			corrected_by: 'Rec 1913',
			corrected_at: expect.any(String),
			speakers: [
				{ speaker_number: 0, label: 'Interviewer — Rec 1913', assigned: true },
				{ speaker_number: 1, label: 'Candidate — Cand 1913', assigned: true },
			],
		});
	});

	test('AC-2/AC-3: candidate receives no mapping internals and no recruiter-gated fields', async () => {
		const candRes = await get(`/api/interviews/recordings/${R_ID}/transcript`, candToken());
		expect(candRes.status).toBe(200);
		const seg0 = candRes.body.transcript.segments.find((s) => s.id === SEG_ID);
		expect(seg0.highlights).toBeUndefined();
		const raw = JSON.stringify(candRes.body);
		expect(raw).not.toMatch(/participant_user_id|sample_turn|participants|Recruiter-only note/);

		// Sanity: the recruiter DOES receive the highlight (gate is real).
		const recRes = await get(`/api/interviews/recordings/${R_ID}/transcript`, recToken());
		const recSeg0 = recRes.body.transcript.segments.find((s) => s.id === SEG_ID);
		expect(recSeg0.highlights).toHaveLength(1);
		expect(recSeg0.highlights[0].note).toBe('Recruiter-only note');
	});

	test('AC-3: candidate detail carries no recruiter_notes; recruiter detail does', async () => {
		const candRes = await get(`/api/interviews/recordings/${R_ID}`, candToken());
		expect(candRes.status).toBe(200);
		expect(candRes.body.recording.recruiter_notes).toBeUndefined();

		const recRes = await get(`/api/interviews/recordings/${R_ID}`, recToken());
		expect(recRes.status).toBe(200);
		expect(recRes.body.recording.recruiter_notes).toEqual({ highlight_count: 1 });
	});

	test('AC-2: /speakers boundary — candidate 403, recruiter 200 (two-account proof)', async () => {
		const candRes = await get(`/api/interviews/recordings/${R_ID}/speakers`, candToken());
		expect(candRes.status).toBe(403);
		const recRes = await get(`/api/interviews/recordings/${R_ID}/speakers`, recToken());
		expect(recRes.status).toBe(200);
		expect(Array.isArray(recRes.body.speakers)).toBe(true);
	});

	test('FR-D19: a candidate who does not own the recording gets no access anywhere', async () => {
		for (const path of [
			`/api/interviews/recordings/${R_ID}/transcript`,
			`/api/interviews/recordings/${R_ID}`,
			`/api/interviews/recordings/${R_ID}/speakers`,
			`/api/interviews/recordings/${R_ID}/playback`,
		]) {
			const res = await get(path, outToken());
			expect(res.status).toBe(403);
		}
	});
});
