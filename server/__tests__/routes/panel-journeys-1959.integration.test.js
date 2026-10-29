/**
 * panel-journeys-1959.integration.test.js — S-D22 (#1959), design §14.
 * Quinn user journeys JT-D8a/b/c for BR-7 panel-speaker labelling notice.
 *
 * Authorship (journey rule): Recruiter persona — recruiter + panel legs;
 * Candidate Experience persona — candidate leg. Assertions are what the
 * USER sees at each step, in the order they live it:
 *   schedule → each person joins on their own screen (token door) →
 *   panel + recruiter see the BR-7 notice BEFORE recording and decide
 *   (capture door) → candidate gives biometric consent in their own flow
 *   (consent door) → interview is recorded → transcript read back through
 *   the recordings doors.
 *
 * HL-003 standard: real HTTP (supertest against the real routers), real
 * gate, real worker, fresh-migrated Postgres (migration 299 included),
 * resulting state read back. The diarization ENGINE is stubbed at the
 * worker's runEngine seam (the established S-D19 pattern) — the engine
 * itself is proven by S-D05/long-proof; the gate, notice, capture and
 * read-back behaviour under test here is never mocked.
 *
 * Run:
 *   SD22_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd22_e2e' \
 *     npx jest server/__tests__/routes/panel-journeys-1959.integration.test.js --forceExit
 *
 * #1969 follow-up (review of PR #1967, minors M1–M6): the JT-D8b leak
 * scan now covers candidate + panel (both members) + recruiter
 * transcript/detail payloads and includes the decliner's name/email
 * (M1/M3); JT-D8b seats a second panel member (M2); JT-D8a's label
 * assertion is pinned to the composed-label shapes (M4); the (3b)
 * notification comment matches its assertion (M5); JT-D8c is
 * independent of JT-D8b's twin store and reads its settled status
 * back from the DB before asserting (M6).
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD22_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;
jest.setTimeout(90000);

const U_REC = 195901;
const U_PANEL = 195902;
const U_CAND = 195903;
const U_PANEL2 = 195904; // #1969 M2: second panel member (JT-D8b)

// #1969 M3: the decliner's identity as seeded below — the leak scan
// rejects payloads carrying any of these, not just the numeric id.
const DECLINER_ID = String(U_PANEL);
const DECLINER_NAME = 'Panel 1959';
const DECLINER_EMAIL = 'panel1959@test.local';

// Privacy C-C settled shape (#1969 M6): the candidate-facing
// diarization object for EVERY blocked variant (declined / withdrawn /
// never decided) — pinned literally so JT-D8c needs no twin store from
// JT-D8b, and drift in any variant fails against the pin itself.
const UNAVAILABLE_DIARIZATION = Object.freeze({
	status: 'unavailable',
	mapping_state: null,
	corrected_by: null,
	corrected_at: null,
	speakers: [],
});

// #1969 M1: the shared posture-leak scan. Rejects the gate codes, any
// decline wording, and the decliner's id/name/email (M3) in a payload.
const LEAK_PATTERNS = [/PANEL_AGREEMENT/, /consent_blocked/, /panel_consent_snapshot/, /cancel_reason/, /declin/i];
const LEAK_STRINGS = [DECLINER_ID, DECLINER_NAME, DECLINER_EMAIL];
function expectNoDeclineLeak(payload) {
	const flat = JSON.stringify(payload);
	for (const pattern of LEAK_PATTERNS) expect(flat).not.toMatch(pattern);
	for (const value of LEAK_STRINGS) expect(flat).not.toContain(value);
}

const ENGINE_OUTPUT = {
	speakerCount: 2,
	turns: [
		{ speaker: 0, start_s: 0, end_s: 1 },
		{ speaker: 1, start_s: 1, end_s: 2 },
	],
	engine: { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' },
};

describeIfDb('S-D22 panel journeys JT-D8 (#1959, real HTTP + real DB)', () => {
	let app;
	let request;
	let generateToken;
	let pool;
	let governingSession;
	let panelLabelling;
	let diarizationJobs;
	let worker;
	let enqueueHelper;

	const tok = (id, email, role) => generateToken({ id, email, role });
	const recTok = () => tok(U_REC, 'rec1959@test.local', 'recruiter');
	const panelTok = () => tok(U_PANEL, 'panel1959@test.local', 'recruiter');
	const panel2Tok = () => tok(U_PANEL2, 'panel2-1959@test.local', 'recruiter');
	const candTok = () => tok(U_CAND, 'cand1959@test.local', 'candidate');

	async function seedUsers() {
		await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[U_REC, U_PANEL, U_CAND, U_PANEL2]]);
		for (const [id, email, name, role] of [
			[U_REC, 'rec1959@test.local', 'Rec 1959', 'recruiter'],
			[U_PANEL, 'panel1959@test.local', 'Panel 1959', 'recruiter'],
			[U_PANEL2, 'panel2-1959@test.local', 'Panel Two 1959', 'recruiter'],
			[U_CAND, 'cand1959@test.local', 'Cand 1959', 'candidate'],
		]) {
			await pool.query(
				`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,'x')`,
				[id, email, name, role],
			);
		}
	}

	/** Step 1 (Recruiter persona): the recruiter schedules a human
	 *  interview with the given panel members (one by default; JT-D8b
	 *  seats two, #1969 M2) — the event + room rows the scheduling
	 *  flow creates. Returns { event, roomId, govId }. */
	async function schedule(panelIds = [U_PANEL]) {
		const job = await pool.query(
			`INSERT INTO jobs (user_id, title) VALUES ($1, 'S-D22 job') RETURNING id`, [U_REC]);
		const ja = await pool.query(
			`INSERT INTO job_applications (job_id, candidate_id, status) VALUES ($1, $2, 'interviewed') RETURNING id`,
			[job.rows[0].id, U_CAND]);
		const ev = await pool.query(
			`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, job_application_id, duration_minutes, timezone, status)
			 VALUES ($1, $2, $3, $4, 60, 'UTC', 'confirmed') RETURNING *`,
			[U_REC, U_CAND, panelIds, ja.rows[0].id]);
		const event = ev.rows[0];
		const room = await pool.query(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
			 VALUES ($1, $2, $3, 'active') RETURNING id`,
			[event.id, `room-1959-${event.id}`, `RM_1959_${event.id}`]);
		const govId = await governingSession.ensureGoverningSession(event, { callerRole: 'recruiter' });
		return { event, roomId: room.rows[0].id, govId };
	}

	/** Step 2: a person joins on their own screen (token door). */
	async function join(roomId, token) {
		return request(app).post(`/api/livekit/rooms/${roomId}/token`)
			.set('Authorization', `Bearer ${token}`).send({});
	}

	/** Step 3: a person records their labelling decision (capture door). */
	async function decide(eventId, roomId, token, rosterVersion, decision) {
		return request(app).post(`/api/interviews/events/${eventId}/labelling-consent`)
			.set('Authorization', `Bearer ${token}`)
			.send({ decision, room_id: roomId, roster_version: rosterVersion });
	}

	/** Step 5 fixture: the recorded interview — recording row carrying
	 *  the frozen expected set (as createRecordingRecord writes it) and
	 *  two transcript segments, one per speaker's turn. */
	async function recordedInterview(event) {
		const freeze = panelLabelling.computeFreeze(event);
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, interview_session_id, status, retention_expires_at, started_at, panel_expected_user_ids, panel_expected_hash)
			 VALUES ($1, NULL, 'completed', NOW() + INTERVAL '90 days', NOW(), $2, $3) RETURNING id`,
			[event.id, freeze.panel_expected_user_ids, freeze.panel_expected_hash]);
		const recordingId = rec.rows[0].id;
		await pool.query(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			 VALUES ($1, 'unknown', 'hello from the candidate', 0, 1000),
			        ($1, 'unknown', 'thanks, let us begin', 1000, 2000)`,
			[recordingId]);
		return recordingId;
	}

	async function runWorkerFor(recordingId) {
		for (let i = 0; i < 8; i++) {
			const claimed = await diarizationJobs.claim('sd22-journey-worker');
			if (!claimed) return null;
			const result = await worker.processJob(claimed, { runEngine: async () => ENGINE_OUTPUT });
			if (Number(claimed.recording_id) === Number(recordingId)) return result;
		}
		return null;
	}
	const segsOf = (body) => body.transcript?.segments ?? [];
	const twin = {}; // JT-D8b-internal: decline twin's settled candidate view (privacy C-C); JT-D8c pins the literal shape instead (#1969 M6)

	async function getDetail(recordingId, token) {
		return request(app).get(`/api/interviews/recordings/${recordingId}`)
			.set('Authorization', `Bearer ${token}`);
	}
	async function getTranscript(recordingId, token) {
		return request(app).get(`/api/interviews/recordings/${recordingId}/transcript`)
			.set('Authorization', `Bearer ${token}`);
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.JWT_SECRET = 'sd22-test-secret';
		process.env.LIVEKIT_API_KEY = 'test-key';
		process.env.LIVEKIT_API_SECRET = 'test-secret';
		process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		({ generateToken } = require('../../../lib/auth'));
		governingSession = require('../../../lib/governingSession');
		panelLabelling = require('../../../lib/panelLabelling');
		diarizationJobs = require('../../../lib/diarizationJobs');
		worker = require('../../../workers/diarization/index');
		enqueueHelper = require('../../../lib/diarizationEnqueue');
		const express = require('express');
		request = require('supertest');
		const eventsRouter = require('../../../routes/interview-events');
		const livekitRouter = require('../../routes/livekit');
		const consentRouter = require('../../routes/consent');
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews', eventsRouter);
		app.use('/api/livekit', livekitRouter);
		app.use('/api/consent', consentRouter);
		app.use('/api/interviews/recordings', recordingsRouter);
		await seedUsers();
	});

	afterAll(async () => {
		delete process.env.DIARIZATION_ENABLED;
		if (pool) await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('JT-D8a (all agree): notice before recording on each own screen → labels on the transcript', async () => {
		const { event, roomId, govId } = await schedule();

		// Each person joins on their own screen.
		const panelJoin = await join(roomId, panelTok());
		expect(panelJoin.status).toBe(200);
		// The panel member sees the BR-7 notice BEFORE recording, with
		// both choices and the decline consequence stated up front.
		expect(panelJoin.body.labelling_notice).toBeTruthy();
		expect(panelJoin.body.labelling_notice.own_decision).toBeNull();
		expect(panelJoin.body.labelling_notice.decision_scope).toBe('panel_leg_only');
		// The decline consequence copy itself is rendered by the client
		// notice from this payload (livekit-room.tsx: 'If you decline: The
		// interview and the recording can still go ahead. No speaker
		// labels will be created…') and is asserted in S-D20's
		// PanelLabellingNotice suite ('states BOTH consequences BEFORE
		// any click'), re-run in this story — see results doc.

		const recJoin = await join(roomId, recTok());
		expect(recJoin.status).toBe(200);
		expect(recJoin.body.labelling_notice).toBeTruthy();
		expect(recJoin.body.labelling_notice.own_decision).toBeNull();

		const candJoin = await join(roomId, candTok());
		expect(candJoin.status).toBe(200);
		// Candidate Experience: the candidate is never shown the panel
		// labelling notice — it is not their decision.
		expect(candJoin.body.labelling_notice).toBeUndefined();

		// Panel member agrees; recruiter agrees — each only for themselves.
		const panelDec = await decide(event.id, roomId, panelTok(),
			panelJoin.body.labelling_notice.roster_version, 'granted');
		expect(panelDec.status).toBe(200);
		const recDec = await decide(event.id, roomId, recTok(),
			recJoin.body.labelling_notice.roster_version, 'granted');
		expect(recDec.status).toBe(200);

		// Candidate gives biometric consent in their own flow.
		const candConsent = await request(app).post('/api/consent/record')
			.set('Authorization', `Bearer ${candTok()}`)
			.send({ sessionId: govId, type: 'biometric', accepted: true, locale: 'en' });
		expect(candConsent.status).toBe(201);

		// The interview is recorded; transcription finishing queues labelling.
		const recordingId = await recordedInterview(event);
		process.env.DIARIZATION_ENABLED = 'true';
		const enq = await enqueueHelper.enqueueDiarizationForRecording(recordingId);
		expect(enq.enqueued).toBe(true);
		const result = await runWorkerFor(recordingId);
		expect(result).not.toBeNull();
		expect(result.outcome).toBe('complete');
		delete process.env.DIARIZATION_ENABLED;

		// The candidate reads their transcript back: it carries speaker
		// labels, and the recording reads as labelled-complete.
		const candTx = await getTranscript(recordingId, candTok());
		expect(candTx.status).toBe(200);
		const segs = segsOf(candTx.body);
		expect(segs.length).toBe(2);
		expect(segs.every((s) => s.diarization_covered === true)).toBe(true);
		// #1969 M4: pinned to the two composed-label shapes the
		// recordings route actually emits — `Speaker N` for an
		// unassigned speaker, `<Role> — <name>` for an assigned one
		// (server/routes/recordings.js labelFor). Any other non-empty
		// string (the old `length > 0` fallback) fails.
		expect(segs.every((s) => /^Speaker \d+$/.test(s.speaker_identity)
			|| /^(Candidate|Interviewer) — .+$/.test(s.speaker_identity))).toBe(true);
		expect(new Set(segs.map((s) => s.speaker_number)).size).toBe(2);
		const candDetail = await getDetail(recordingId, candTok());
		expect(candDetail.body.recording.diarization_status).toBe('complete');
	});

	it('JT-D8b (decline twin): recording proceeds, transcript unlabelled, NO surface says a decline is why', async () => {
		// #1969 M2: TWO panel members are seated — the decliner and a
		// second member who grants — so another member's surfaces are
		// exercised, not just the decliner's own (where seeing their
		// own decision is legitimate).
		const { event, roomId, govId } = await schedule([U_PANEL, U_PANEL2]);

		const panelJoin = await join(roomId, panelTok());
		expect(panelJoin.status).toBe(200);
		// Told BEFORE clicking: declining means the interview and the
		// recording still go ahead, without labels.
		expect(panelJoin.body.labelling_notice.own_decision).toBeNull(); // consequence copy: client notice, S-D20 suite (see JT-D8a note)
		const panel2Join = await join(roomId, panel2Tok());
		expect(panel2Join.status).toBe(200);
		// The second member's notice carries only THEIR OWN state —
		// undecided here; it never carries the decliner's posture.
		expect(panel2Join.body.labelling_notice.own_decision).toBeNull();
		const recJoin = await join(roomId, recTok());
		expect(recJoin.status).toBe(200);

		const panelDec = await decide(event.id, roomId, panelTok(),
			panelJoin.body.labelling_notice.roster_version, 'declined');
		expect(panelDec.status).toBe(200);
		const recDec = await decide(event.id, roomId, recTok(),
			recJoin.body.labelling_notice.roster_version, 'granted');
		expect(recDec.status).toBe(200);
		// The second member grants, so the decliner is the SOLE blocker:
		// enqueue suppression below is attributable to the decline leg
		// alone, with a full cross-member surface to scan.
		const panel2Dec = await decide(event.id, roomId, panel2Tok(),
			panel2Join.body.labelling_notice.roster_version, 'granted');
		expect(panel2Dec.status).toBe(200);

		const candConsent = await request(app).post('/api/consent/record')
			.set('Authorization', `Bearer ${candTok()}`)
			.send({ sessionId: govId, type: 'biometric', accepted: true, locale: 'en' });
		expect(candConsent.status).toBe(201);

		// Interview + recording proceed normally.
		const recordingId = await recordedInterview(event);
		const recRow = await pool.query(
			`SELECT status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(recRow.rows[0].status).toBe('completed');

		process.env.DIARIZATION_ENABLED = 'true';
		const enq = await enqueueHelper.enqueueDiarizationForRecording(recordingId);
		expect(enq.enqueued).toBe(false);
		delete process.env.DIARIZATION_ENABLED;

		// Settled state first (privacy C-A): status assertions are taken
		// only after the enqueue verdict and the DB read-back agree the
		// recording has settled — never mid-window.
		const settled = await pool.query(
			`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(settled.rows[0].diarization_status).toBe('unavailable');

		// POSTURE-LEAK ASSERTIONS (privacy engineer, mandatory):
		// (1) the candidate's transcript is unlabelled;
		const candTx = await getTranscript(recordingId, candTok());
		expect(candTx.status).toBe(200);
		const segs = segsOf(candTx.body);
		expect(segs.length).toBe(2);
		expect(segs.every((s) => s.speaker_number === null || s.speaker_number === undefined)).toBe(true);
		// Twin store for C-C deep-equality against the withdrawn twin
		// below (same test): the whole diarization object, not just
		// the status. It is ALSO pinned to the literal settled shape —
		// the same pin JT-D8c asserts independently (#1969 M6).
		twin.diarization = candTx.body.transcript.diarization;
		expect(twin.diarization.status).toBe('unavailable');
		expect(twin.diarization.speakers).toEqual([]);
		expect(twin.diarization).toEqual(UNAVAILABLE_DIARIZATION);
		// (2) the candidate's labelling state is the same honest
		// 'unavailable' as any other block — no reason attached;
		const candDetail = await getDetail(recordingId, candTok());
		expect(candDetail.body.recording.diarization_status).toBe('unavailable');
		// (3) NOTHING in any candidate-, panel- or recruiter-facing
		// payload names the decline, the gate code, or the decliner
		// (#1969 M1: the scan covers the panel transcript body, the
		// panel detail, the SECOND panel member's payloads (M2), and
		// the recruiter's transcript + detail — not candidate payloads
		// only; M3: the decliner's name and email are in the scan set).
		const panelDetail = await getDetail(recordingId, panelTok());
		expect(panelDetail.status).toBe(200);
		expect(panelDetail.body.recording.diarization_status).toBe('unavailable');
		const panelTx = await getTranscript(recordingId, panelTok());
		expect(panelTx.status).toBe(200);
		const panel2Detail = await getDetail(recordingId, panel2Tok());
		expect(panel2Detail.status).toBe(200);
		expect(panel2Detail.body.recording.diarization_status).toBe('unavailable');
		const panel2Tx = await getTranscript(recordingId, panel2Tok());
		expect(panel2Tx.status).toBe(200);
		const recDetail = await getDetail(recordingId, recTok());
		expect(recDetail.status).toBe(200);
		expect(recDetail.body.recording.diarization_status).toBe('unavailable');
		const recTx = await getTranscript(recordingId, recTok());
		expect(recTx.status).toBe(200);
		for (const payload of [candTx.body, candDetail.body,
			panelTx.body, panelDetail.body,
			panel2Tx.body, panel2Detail.body,
			recTx.body, recDetail.body]) {
			expectNoDeclineLeak(payload);
		}
		// (3b) Notification isolation (privacy A7, state read back):
		// each DECIDER may receive their own C-6d decision line (the
		// decliner, the granting recruiter, the granting second panel
		// member); the candidate receives none, and a notification
		// naming a DECLINE reaches only the decliner (#1969 M5 —
		// comment reconciled to this assertion).
		const notifs = await pool.query(
			`SELECT user_id, message FROM user_notifications
			 WHERE metadata->>'event_id' = $1 OR message ILIKE '%speaker labelling%' AND user_id = ANY($2)`,
			[String(event.id), [U_REC, U_PANEL, U_PANEL2, U_CAND]]);
		const labellingNotifs = notifs.rows.filter((n) => /speaker labelling/i.test(n.message));
		expect(labellingNotifs.length).toBeGreaterThan(0);
		expect(labellingNotifs.every((n) => [U_PANEL, U_PANEL2, U_REC].includes(Number(n.user_id)))).toBe(true);
		expect(labellingNotifs.filter((n) => /declined/i.test(n.message)).every((n) => Number(n.user_id) === U_PANEL)).toBe(true);
		expect(labellingNotifs.some((n) => Number(n.user_id) === U_CAND)).toBe(false);
		// (3c) Audit boundary lock (privacy A9 regression): panel capture
		// audit rows carry company_id NULL, so company-scoped audit
		// readers (incl. the decliner's own recruiter) can never see
		// actor + decision; only the platform admin (operator) can.
		const audit = await pool.query(
			`SELECT company_id, payload FROM compliance_audit_trail
			 WHERE payload->>'kind' = 'panel_labelling_capture' AND (payload->>'event_id') = $1`,
			[String(event.id)]);
		expect(audit.rows.length).toBeGreaterThan(0);
		expect(audit.rows.every((r) => r.company_id === null)).toBe(true);
		// (4) the decliner's participation is otherwise identical:
		// they can still join (their recorded decline renders as their
		// own status, not a re-prompt) and read the transcript.
		const panelRejoin = await join(roomId, panelTok());
		expect(panelRejoin.status).toBe(200);
		expect(panelRejoin.body.labelling_notice.own_decision).toBe('declined');
		expect(panelTx.status).toBe(200);
		// …and the second member's participation is likewise identical:
		// their rejoin renders their OWN recorded grant — never the
		// decliner's decision (#1969 M2 cross-member surface).
		const panel2Rejoin = await join(roomId, panel2Tok());
		expect(panel2Rejoin.status).toBe(200);
		expect(panel2Rejoin.body.labelling_notice.own_decision).toBe('granted');

		// V3 withdrawn twin (privacy C-C): panel grants, then withdraws
		// before transcription — the candidate's settled view must be
		// DEEP-EQUAL to the decline twin's, field for field.
		const w = await schedule();
		const wPanelJoin = await join(w.roomId, panelTok());
		const wRecJoin = await join(w.roomId, recTok());
		expect((await decide(w.event.id, w.roomId, panelTok(),
			wPanelJoin.body.labelling_notice.roster_version, 'granted')).status).toBe(200);
		expect((await decide(w.event.id, w.roomId, recTok(),
			wRecJoin.body.labelling_notice.roster_version, 'granted')).status).toBe(200);
		const wRejoin = await join(w.roomId, panelTok());
		expect((await decide(w.event.id, w.roomId, panelTok(),
			wRejoin.body.labelling_notice.roster_version, 'withdrawn')).status).toBe(200);
		expect((await request(app).post('/api/consent/record')
			.set('Authorization', `Bearer ${candTok()}`)
			.send({ sessionId: w.govId, type: 'biometric', accepted: true, locale: 'en' })).status).toBe(201);
		const wRecId = await recordedInterview(w.event);
		process.env.DIARIZATION_ENABLED = 'true';
		const wEnq = await enqueueHelper.enqueueDiarizationForRecording(wRecId);
		delete process.env.DIARIZATION_ENABLED;
		expect(wEnq.enqueued).toBe(false);
		const wTx = await getTranscript(wRecId, candTok());
		expect(wTx.body.transcript.diarization).toEqual(twin.diarization);
		const wDetail = await getDetail(wRecId, candTok());
		expect(wDetail.body.recording.diarization_status).toBe('unavailable');
		// The withdrawn twin's candidate payloads pass the same shared
		// scan (#1969 M1) — a withdrawal must not leak either.
		expectNoDeclineLeak(wTx.body);
		expectNoDeclineLeak(wDetail.body);
	});

	it('JT-D8c (never asked, never decided): no labels; only the operator record names the missing agreement', async () => {
		const { event, roomId, govId } = await schedule();

		const panelJoin = await join(roomId, panelTok());
		expect(panelJoin.status).toBe(200);
		expect(panelJoin.body.labelling_notice.own_decision).toBeNull();
		const recJoin = await join(roomId, recTok());
		// Recruiter agrees; the panel member makes NO decision.
		const recDec = await decide(event.id, roomId, recTok(),
			recJoin.body.labelling_notice.roster_version, 'granted');
		expect(recDec.status).toBe(200);

		const candConsent = await request(app).post('/api/consent/record')
			.set('Authorization', `Bearer ${candTok()}`)
			.send({ sessionId: govId, type: 'biometric', accepted: true, locale: 'en' });
		expect(candConsent.status).toBe(201);

		const recordingId = await recordedInterview(event);
		process.env.DIARIZATION_ENABLED = 'true';
		const enq = await enqueueHelper.enqueueDiarizationForRecording(recordingId);
		delete process.env.DIARIZATION_ENABLED;
		expect(enq.enqueued).toBe(false);

		// Settled state first (privacy C-A, #1969 M6): the explicit DB
		// read-back agrees the recording has settled BEFORE any payload
		// assertion — same discipline as JT-D8b, not settled-by-
		// construction alone.
		const settled = await pool.query(
			`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(settled.rows[0].diarization_status).toBe('unavailable');

		// No labels anywhere a user looks.
		const candTx = await getTranscript(recordingId, candTok());
		const segs = segsOf(candTx.body);
		expect(segs.length).toBe(2);
		expect(segs.every((s) => s.speaker_number === null || s.speaker_number === undefined)).toBe(true);
		const candDetail = await getDetail(recordingId, candTok());
		expect(candDetail.body.recording.diarization_status).toBe('unavailable');
		expect(JSON.stringify(candDetail.body)).not.toMatch(/PANEL_AGREEMENT/);
		// C-C twin equality, independently (#1969 M6): the never-decided
		// variant's candidate view is deep-equal to the PINNED settled
		// shape — the same literal JT-D8b pins its decline twin to — so
		// this test stands alone (no in-file twin store from D8b) and
		// any variant-specific marker or drift fails against the pin.
		expect(candTx.body.transcript.diarization).toEqual(UNAVAILABLE_DIARIZATION);
		const panelDetail = await getDetail(recordingId, panelTok());
		expect(JSON.stringify(panelDetail.body)).not.toMatch(/PANEL_AGREEMENT/);

		// The operator-side record alone carries the reason: either the
		// enqueue verdict or a job's cancel reason names
		// PANEL_AGREEMENT_MISSING — visible in the operator's DB record,
		// never in a candidate/panel payload above.
		let operatorCode = enq && enq.code ? enq.code : null;
		if (!operatorCode) {
			const jobRow = await pool.query(
				`SELECT cancel_reason FROM diarization_jobs WHERE recording_id = $1 ORDER BY id DESC LIMIT 1`,
				[recordingId]);
			operatorCode = jobRow.rows[0]?.cancel_reason ?? '';
		}
		expect(String(operatorCode)).toContain('PANEL_AGREEMENT_MISSING');
	});
});
