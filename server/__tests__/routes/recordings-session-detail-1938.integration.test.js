/**
 * #1938 — GET /recordings/:id detail 403s the owning candidate on
 * session-linked recordings, while transcript/playback grant access.
 *
 * Quinn journey suite on the real rig (HL-003): REAL recordings router,
 * REAL lib/db, REAL auth over HTTP via supertest, real Postgres seeded
 * directly. Synthetic fixtures only. A session-linked recording has
 * interview_session_id set and NO interview event / room.
 *
 * Journey (user's exact complaint first): the candidate who sat the AI
 * screening opens their recording detail → expect 200, exactly as they
 * already get on transcript/playback. A non-owning candidate and a
 * recruiter from another company must still get 403; the owning
 * company's recruiter access is unchanged (200 + recruiter_notes).
 *
 * Run:
 *   SD1938_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd1938_fresh' \
 *     npx jest server/__tests__/routes/recordings-session-detail-1938.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD1938_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 193801;
const U_CAND = 193802;
const U_OUT = 193803;
const U_REC_OTHER = 193804;
const C_ID = 19381;
const C_OTHER = 19382;

let app;
let request;
let generateToken;
let seedPool;
let R_ID;
let S_ID;

function tokenFor(id, email, role) {
	return generateToken({ id, email, role });
}
const recToken = () => tokenFor(U_REC, 'rec1938@test.local', 'recruiter');
const candToken = () => tokenFor(U_CAND, 'cand1938@test.local', 'candidate');
const outToken = () => tokenFor(U_OUT, 'out1938@test.local', 'candidate');
const recOtherToken = () => tokenFor(U_REC_OTHER, 'recother1938@test.local', 'recruiter');

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_OUT, U_REC_OTHER];
	await q(`DELETE FROM interview_transcripts WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))`, [U_CAND]);
	await q(`DELETE FROM recording_consent WHERE recording_id IN (SELECT id FROM interview_recordings WHERE interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1))`, [U_CAND]);
	await q(`DELETE FROM interview_recordings WHERE interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)`, [U_CAND]);
	await q(`DELETE FROM interview_sessions WHERE candidate_id = $1`, [U_CAND]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = ANY($1::int[])`, [[C_ID, C_OTHER]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-1938 Co'), ($2, 'Other Co')`, [C_ID, C_OTHER]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1938@test.local', 'Rec 1938', 'recruiter', $5),
		   ($2, 'cand1938@test.local', 'Cand 1938', 'candidate', NULL),
		   ($3, 'out1938@test.local', 'Out 1938', 'candidate', NULL),
		   ($4, 'recother1938@test.local', 'Rec Other 1938', 'recruiter', $6)`,
		[U_REC, U_CAND, U_OUT, U_REC_OTHER, C_ID, C_OTHER],
	);
	const sess = await q(
		`INSERT INTO interview_sessions (type, candidate_id, company_id, triggered_by, status)
		 VALUES ('screening', $1, $2, $3, 'completed') RETURNING id`,
		[U_CAND, C_ID, U_REC],
	);
	S_ID = sess.rows[0].id;
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, interview_session_id, status, duration_seconds, storage_path)
		 VALUES (NULL, NULL, $1, 'completed', 3600, 'stub') RETURNING id`,
		[S_ID],
	);
	R_ID = rec.rows[0].id;
	await q(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
		 VALUES ($1, 'candidate', 'I led a team of five.', 0, 4000)`,
		[R_ID],
	);
	await q(`INSERT INTO recording_consent (recording_id, user_id) VALUES ($1, $2)`, [R_ID, U_CAND]);
}

async function get(path, token) {
	return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

describeIfDb('#1938 session-linked recording detail (realdb journey)', () => {
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

	test("user's complaint: owning candidate opens session-linked recording detail (200)", async () => {
		const res = await get(`/api/interviews/recordings/${R_ID}`, candToken());
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.recording.id).toBe(R_ID);
		expect(res.body.recording.transcript.segment_count).toBe(1);
		// Candidates never receive recruiter-gated fields.
		expect(res.body.recording.recruiter_notes).toBeUndefined();
	});

	test('control: owning candidate already gets transcript on the same recording (200)', async () => {
		const res = await get(`/api/interviews/recordings/${R_ID}/transcript`, candToken());
		expect(res.status).toBe(200);
	});

	test('non-owning candidate still gets 403 on detail', async () => {
		const res = await get(`/api/interviews/recordings/${R_ID}`, outToken());
		expect(res.status).toBe(403);
	});

	test('recruiter access unchanged: owning-company recruiter gets 200 + recruiter_notes', async () => {
		const res = await get(`/api/interviews/recordings/${R_ID}`, recToken());
		expect(res.status).toBe(200);
		expect(res.body.recording.recruiter_notes).toEqual({ highlight_count: 0 });
	});

	test('recruiter from another company still gets 403 on detail', async () => {
		const res = await get(`/api/interviews/recordings/${R_ID}`, recOtherToken());
		expect(res.status).toBe(403);
	});
});
