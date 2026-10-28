/**
 * #1914 (S-D12) — Operator visibility of labelling health.
 * Architecture §7 / §4.1 / §6.3; PRD FR-D04, journey J6.
 *
 * Quinn-style journey suite on the real rig (HL-003): the REAL recordings
 * router + the REAL admin router, REAL lib/db, REAL auth over HTTP via
 * supertest, against a real Postgres seeded directly. State is read back
 * through the same HTTP surfaces an operator/recruiter actually uses.
 * Synthetic fixtures only; DIARIZATION_ENABLED stays OFF; no real recordings.
 *
 * AC-1: recording-management list + detail carry diarization_status beside
 *       recording status; NULL renders as null (client shows nothing).
 * AC-2: GET /api/admin/diarization/stats — admin-gated exactly like its
 *       sibling /api/admin/agents/stats (requireAdmin; denial is the same
 *       401) — returns diarization_jobs counts by status and failure counts
 *       by error_class over a chosen window (?days=, default 30).
 * AC-3: user-facing recording/transcript responses never contain
 *       error_class / error_message keys or values (§6.3 leak check),
 *       even when the underlying failed jobs carry sentinel values.
 *
 * Run:
 *   SD12_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd12_e2e' \
 *     npx jest server/__tests__/routes/recordings-operator-visibility-1914.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD12_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191401;
const U_CAND = 191402;
const U_ADMIN = 191403;
const U_OUT = 191404;
const U_PEER = 191405;
const U_OTHERCO = 191406;
const C_ID = 19141;
const C2_ID = 19142;

const SENTINEL_MSG_ENGINE = 'SENTINEL_MSG_ENGINE_1914';
const SENTINEL_MSG_DECODE = 'SENTINEL_MSG_DECODE_1914';

let app;
let request;
let generateToken;
let seedPool;

const R = {};
let EVENT_ID;

const tokenFor = (id, email, role) => generateToken({ id, email, role });
const recToken = () => tokenFor(U_REC, 'rec1914@test.local', 'recruiter');
const candToken = () => tokenFor(U_CAND, 'cand1914@test.local', 'candidate');
const outToken = () => tokenFor(U_OUT, 'out1914@test.local', 'candidate');
const peerToken = () => tokenFor(U_PEER, 'peer1914@test.local', 'recruiter');
const otherCoToken = () => tokenFor(U_OTHERCO, 'other1914@test.local', 'recruiter');
const adminToken = () => tokenFor(U_ADMIN, 'admin1914@test.local', 'admin');

async function seedRecording(eventId, roomId, diarizationStatus) {
	const res = await seedPool.query(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, $2, 'completed', 1800, 'stub', $3) RETURNING id`,
		[eventId, roomId, diarizationStatus],
	);
	return res.rows[0].id;
}

async function seedJob(recordingId, status, errorClass, errorMessage, createdDaysAgo) {
	await seedPool.query(
		`INSERT INTO diarization_jobs (recording_id, status, error_class, error_message, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, NOW() - ($5 || ' days')::interval, NOW() - ($5 || ' days')::interval)`,
		[recordingId, status, errorClass, errorMessage, String(createdDaysAgo)],
	);
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_ADMIN, U_OUT, U_PEER, U_OTHERCO];
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})
		OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $2)`;
	for (const table of ['interview_transcripts', 'diarization_runs', 'diarization_jobs']) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, U_CAND]);
	}
	// The AC-2 aggregate is GLOBAL by design (all jobs in the window), so
	// its ground truth is only exact on this suite's dedicated rig DB:
	// clear every job/run row (synthetic rig data only) before seeding.
	await q(`DELETE FROM diarization_runs`);
	await q(`DELETE FROM diarization_jobs`);
	await q(`DELETE FROM interview_recordings WHERE id IN (${recScope})`, [U_REC, U_CAND]);
	await q(`DELETE FROM interview_sessions WHERE candidate_id = $1`, [U_CAND]);
	await q(`DELETE FROM interview_rooms WHERE interview_event_id IN (${eventScope})`, [U_REC, U_CAND]);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`, [U_REC, U_CAND]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = ANY($1::int[])`, [[C_ID, C2_ID]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D12 Co'), ($2, 'S-D12 Other Co')`, [C_ID, C2_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1914@test.local', 'Rec 1914', 'recruiter', $4),
		   ($2, 'cand1914@test.local', 'Cand 1914', 'candidate', $4),
		   ($3, 'admin1914@test.local', 'Admin 1914', 'admin', NULL),
		   ($5, 'out1914@test.local', 'Out 1914', 'candidate', NULL),
		   ($6, 'peer1914@test.local', 'Peer 1914', 'recruiter', $4),
		   ($7, 'other1914@test.local', 'Other 1914', 'recruiter', $8)`,
		[U_REC, U_CAND, U_ADMIN, C_ID, U_OUT, U_PEER, U_OTHERCO, C2_ID],
	);
	// Final-delta fixture: the candidate is an INTERNAL candidate
	// (company_id = the event recruiter's company) holding an RBAC
	// assignment whose role carries interviews:read — the one
	// candidate-class path that can pass BOTH list gates (permission +
	// event company check). The list must still fold for them.
	await q(`DELETE FROM user_roles WHERE user_id = ANY($1::int[])`, [userIds]);
	const rbacRole = await q(`SELECT id FROM roles WHERE name = 'recruiter'`);
	await q(`INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`, [
		U_CAND,
		rbacRole.rows[0].id,
		C_ID,
	]);

	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1, $2, '{}'::int[], 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	EVENT_ID = ev.rows[0].id;
	const room = await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1, $2, $3, 'closed') RETURNING id`,
		[EVENT_ID, `room-${EVENT_ID}`, `lk-${EVENT_ID}`],
	);
	const roomId = room.rows[0].id;

	R.complete = await seedRecording(EVENT_ID, roomId, 'complete');
	R.legacy = await seedRecording(EVENT_ID, roomId, null);
	R.failed = await seedRecording(EVENT_ID, roomId, 'failed');
	R.unavailable = await seedRecording(EVENT_ID, roomId, 'unavailable');

	await q(
		`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
		 VALUES ($1, 'unknown', 'A segment with no labels.', 0, 3000)`,
		[R.failed],
	);

	// Session-linked recordings (AI screening/interview shape — the
	// diarization-relevant kind): access derives from the SESSION
	// relationship, not the event. Same folding must hold here.
	const sess = await q(
		`INSERT INTO interview_sessions (candidate_id, company_id, status)
		 VALUES ($1, $2, 'completed') RETURNING id`,
		[U_CAND, C_ID],
	);
	const sessId = sess.rows[0].id;
	for (const [key, status] of [['sessFailed', 'failed'], ['sessUnavailable', 'unavailable']]) {
		const rec = await q(
			`INSERT INTO interview_recordings
			   (interview_session_id, status, duration_seconds, storage_path, diarization_status)
			 VALUES ($1, 'completed', 1800, 'stub', $2) RETURNING id`,
			[sessId, status],
		);
		R[key] = rec.rows[0].id;
	}

	// Jobs inside the default 30-day window.
	await seedJob(R.complete, 'complete', null, null, 0);
	await seedJob(R.complete, 'pending', null, null, 0);
	await seedJob(R.failed, 'processing', null, null, 0);
	await seedJob(R.failed, 'failed', 'engine_failed', SENTINEL_MSG_ENGINE, 0);
	await seedJob(R.failed, 'failed', 'decode_failed', SENTINEL_MSG_DECODE, 0);
	// One old failure OUTSIDE the default window, inside a 60-day window.
	await seedJob(R.failed, 'failed', 'engine_timeout', 'SENTINEL_MSG_OLD_1914', 40);
}

function get(path, token) {
	const req = request(app).get(path);
	if (token) req.set('Authorization', `Bearer ${token}`);
	return req;
}

describeIfDb('#1914 S-D12 operator visibility (realdb journey)', () => {
	beforeAll(async () => {
		// Env BEFORE the routers (and lib/db's pool) load — the 1904 pattern.
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		const adminRouter = require('../../../routes/admin');
		app = express();
		app.use(express.json());
		// Minimal session object: the real app provides express-session;
		// requireAdmin's bridge writes to req.session after its DB role
		// re-check, exactly as in production.
		app.use((req, _res, next) => {
			if (!req.session) req.session = {};
			next();
		});
		app.use('/api/interviews/recordings', recordingsRouter);
		app.use('/api/admin', adminRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('AC-1: recruiter list shows diarization_status beside status; NULL stays null', async () => {
		const res = await get(`/api/interviews/recordings?event_id=${EVENT_ID}`, recToken());
		expect(res.status).toBe(200);
		const byId = new Map(res.body.recordings.map((r) => [r.id, r]));
		expect(byId.get(R.complete).status).toBe('completed');
		expect(byId.get(R.complete).diarization_status).toBe('complete');
		expect(byId.get(R.failed).diarization_status).toBe('failed');
		expect(byId.has(R.legacy)).toBe(true);
		expect(byId.get(R.legacy).diarization_status).toBeNull();
	});

	test('AC-1: recording detail carries diarization_status (value and NULL)', async () => {
		const done = await get(`/api/interviews/recordings/${R.complete}`, recToken());
		expect(done.status).toBe(200);
		expect(done.body.recording.diarization_status).toBe('complete');

		const legacy = await get(`/api/interviews/recordings/${R.legacy}`, recToken());
		expect(legacy.status).toBe(200);
		expect(legacy.body.recording.diarization_status).toBeNull();
	});

	test('AC-1/§6.3 (privacy BLOCK fix): candidate detail cannot distinguish failed from unavailable', async () => {
		// The detail payload is dual-audience: the owning candidate can
		// read it. Raw failed-vs-unavailable would signal whether the
		// candidate's own consent posture blocked labelling (§4.1) — so
		// the candidate receives the §5.1 folded value, exactly like the
		// transcript surface, while the recruiter keeps the raw value.
		const candFailed = await get(`/api/interviews/recordings/${R.failed}`, candToken());
		expect(candFailed.status).toBe(200);
		expect(candFailed.body.recording.diarization_status).toBe('unavailable');

		const candUnavail = await get(`/api/interviews/recordings/${R.unavailable}`, candToken());
		expect(candUnavail.status).toBe(200);
		expect(candUnavail.body.recording.diarization_status).toBe('unavailable');

		const recFailed = await get(`/api/interviews/recordings/${R.failed}`, recToken());
		expect(recFailed.body.recording.diarization_status).toBe('failed');
		const recUnavail = await get(`/api/interviews/recordings/${R.unavailable}`, recToken());
		expect(recUnavail.body.recording.diarization_status).toBe('unavailable');

		// Non-failure states pass through unfolded for the candidate too
		// (parity with the transcript surface they already see).
		const candComplete = await get(`/api/interviews/recordings/${R.complete}`, candToken());
		expect(candComplete.body.recording.diarization_status).toBe('complete');

		// Session-linked branch (delta-review gap): access here derives
		// from the session relationship. The viewer the handler gates on
		// is the DB user row (authMiddleware SELECTs the full row), so
		// the same folding must hold — candidate indistinguishable,
		// company recruiter raw.
		const candSessFailed = await get(`/api/interviews/recordings/${R.sessFailed}`, candToken());
		expect(candSessFailed.status).toBe(200);
		expect(candSessFailed.body.recording.diarization_status).toBe('unavailable');
		const candSessUnavail = await get(`/api/interviews/recordings/${R.sessUnavailable}`, candToken());
		expect(candSessUnavail.status).toBe(200);
		expect(candSessUnavail.body.recording.diarization_status).toBe('unavailable');
		const recSessFailed = await get(`/api/interviews/recordings/${R.sessFailed}`, recToken());
		expect(recSessFailed.status).toBe(200);
		expect(recSessFailed.body.recording.diarization_status).toBe('failed');

		// Evidentiary chain (final delta): a candidate who is NOT the
		// session's candidate gets no access at all on either session
		// recording — 403, so no status, raw or folded, reaches them.
		// Together with the owner assertions above (seeded session
		// candidate, folded) and the company recruiter (raw), viewer
		// derivation on the session branch is proven through the handler.
		const outSessFailed = await get(`/api/interviews/recordings/${R.sessFailed}`, outToken());
		expect(outSessFailed.status).toBe(403);
		const outSessUnavail = await get(`/api/interviews/recordings/${R.sessUnavailable}`, outToken());
		expect(outSessUnavail.status).toBe(403);

		// Event-linked viewer classes (final delta item): role-class
		// inclusion for the RAW value must be proven on THIS branch too,
		// whose access derives from event/company, not the session.
		// A same-company peer recruiter (not of record, not panel) is an
		// operator-side viewer via the company scope → raw 'failed'.
		const peerFailed = await get(`/api/interviews/recordings/${R.failed}`, peerToken());
		expect(peerFailed.status).toBe(200);
		expect(peerFailed.body.recording.diarization_status).toBe('failed');
		// An other-company recruiter has no access at all → 403, no status.
		const otherFailed = await get(`/api/interviews/recordings/${R.failed}`, otherCoToken());
		expect(otherFailed.status).toBe(403);
	});

	test('AC-1/§6.3 (list folding): an RBAC-granted internal candidate reaches the list but never the raw value', async () => {
		// U_CAND holds interviews:read via user_roles and shares the
		// event's company, so both list gates pass — the response must
		// still fold failed/unavailable to 'unavailable' for them,
		// while the recruiter's list (AC-1 above) stays raw.
		const res = await get(`/api/interviews/recordings?event_id=${EVENT_ID}`, candToken());
		expect(res.status).toBe(200);
		const byId = new Map(res.body.recordings.map((r) => [r.id, r]));
		expect(byId.get(R.failed).diarization_status).toBe('unavailable');
		expect(byId.get(R.unavailable).diarization_status).toBe('unavailable');
		expect(byId.get(R.complete).diarization_status).toBe('complete');
		expect(byId.get(R.legacy).diarization_status).toBeNull();
	});

	test('AC-2: admin aggregate — counts by status + failures by error_class, default 30d window', async () => {
		const res = await get('/api/admin/diarization/stats', adminToken());
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d.window_days).toBe(30);
		expect(d.by_status.complete).toBe(1);
		expect(d.by_status.pending).toBe(1);
		expect(d.by_status.processing).toBe(1);
		expect(d.by_status.failed).toBe(2);
		expect(d.failures_by_error_class).toEqual({ engine_failed: 1, decode_failed: 1 });
		expect(typeof d.oldest_pending_age_seconds).toBe('number');
		expect(d.oldest_pending_age_seconds).toBeGreaterThanOrEqual(0);
	});

	test('AC-2: chosen window — ?days=60 pulls the 40-day-old failure in; ?days is clamped', async () => {
		const res = await get('/api/admin/diarization/stats?days=60', adminToken());
		expect(res.status).toBe(200);
		expect(res.body.data.window_days).toBe(60);
		expect(res.body.data.by_status.failed).toBe(3);
		expect(res.body.data.failures_by_error_class).toEqual({
			engine_failed: 1,
			decode_failed: 1,
			engine_timeout: 1,
		});

		const clamped = await get('/api/admin/diarization/stats?days=99999', adminToken());
		expect(clamped.status).toBe(200);
		expect(clamped.body.data.window_days).toBe(365);

		const invalid = await get('/api/admin/diarization/stats?days=abc', adminToken());
		expect(invalid.status).toBe(200);
		expect(invalid.body.data.window_days).toBe(30);
	});

	test('AC-2: non-admins get the sibling admin denial (401, same body)', async () => {
		const anon = await get('/api/admin/diarization/stats', null);
		expect(anon.status).toBe(401);
		expect(anon.body).toEqual({ error: 'Admin authentication required' });

		const rec = await get('/api/admin/diarization/stats', recToken());
		expect(rec.status).toBe(401);
		expect(rec.body).toEqual({ error: 'Admin authentication required' });

		const cand = await get('/api/admin/diarization/stats', candToken());
		expect(cand.status).toBe(401);
	});

	test('AC-3: no user-facing response leaks error_class / error_message keys or values (§6.3)', async () => {
		const surfaces = [
			await get(`/api/interviews/recordings?event_id=${EVENT_ID}`, recToken()),
			await get(`/api/interviews/recordings/${R.failed}`, recToken()),
			await get(`/api/interviews/recordings/${R.failed}/transcript`, recToken()),
			await get(`/api/interviews/recordings/${R.failed}/transcript`, candToken()),
		];
		for (const res of surfaces) {
			expect(res.status).toBe(200);
			const raw = JSON.stringify(res.body);
			expect(raw).not.toContain('error_class');
			expect(raw).not.toContain('error_message');
			expect(raw).not.toContain(SENTINEL_MSG_ENGINE);
			expect(raw).not.toContain(SENTINEL_MSG_DECODE);
			expect(raw).not.toContain('engine_failed');
			expect(raw).not.toContain('decode_failed');
		}
		// The failed recording's transcript folds failure into the single
		// honest user-visible state (§5.1/§6.3) — never the reason.
		const t = surfaces[2].body.transcript;
		expect(t.diarization.status).toBe('unavailable');
	});
});
