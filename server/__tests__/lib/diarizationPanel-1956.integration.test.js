/**
 * diarizationPanel-1956.integration.test.js — S-D19 (#1956), design §14
 * I1–I7 + T13 (real-DB halves). HL-003 standard: NO mocks — real gate,
 * real worker, real capture endpoint, real erasure, fresh-migrated
 * Postgres (migration 299 included), resulting state read back.
 *
 * Run:
 *   SD19_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd19_e2e' \
 *     npx jest server/__tests__/lib/diarizationPanel-1956.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.SD19_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('S-D19 panel leg (real DB — #1956)', () => {
	jest.setTimeout(60000);
	let pool;
	let consentService;
	let diarizationJobs;
	let worker;
	let governingSession;
	let panelLabelling;
	let enqueueHelper;
	let erasePersonalData;

	const U_CAND = 195601;
	const U_REC = 195602;
	const U_PANEL = 195603;
	const U_PANEL2 = 195604;
	const U_CAND2 = 195605;

	const ENGINE_OUTPUT = {
		speakerCount: 1,
		turns: [{ speaker: 0, start_s: 0, end_s: 1 }],
		engine: { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' },
	};

	async function seedUsers() {
		for (const [id, email, name, role] of [
			[U_CAND, 'cand1956@test.local', 'Cand 1956', 'candidate'],
			[U_REC, 'rec1956@test.local', 'Rec 1956', 'recruiter'],
			[U_PANEL, 'panel1956@test.local', 'Panel 1956', 'recruiter'],
			[U_PANEL2, 'panel21956@test.local', 'Panel2 1956', 'recruiter'],
			[U_CAND2, 'cand21956@test.local', 'Cand2 1956', 'candidate'],
		]) {
			await pool.query(
				`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,'x')
				 ON CONFLICT (id) DO NOTHING`,
				[id, email, name, role],
			);
		}
	}

	/** Full bridge fixture: event + governing session + candidate grant +
	 *  frozen panel set + panel decisions + one segment. */
	async function bridgeFixture({ decisions = { [U_REC]: 'granted', [U_PANEL]: 'granted' } } = {}) {
		const job = await pool.query(
			`INSERT INTO jobs (user_id, title) VALUES ($1, 'S-D19 job') RETURNING id`, [U_REC]);
		const ja = await pool.query(
			`INSERT INTO job_applications (job_id, candidate_id, status) VALUES ($1, $2, 'interviewed') RETURNING id`,
			[job.rows[0].id, U_CAND]);
		const ev = await pool.query(
			`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, job_application_id, duration_minutes, timezone, status)
			 VALUES ($1, $2, $3, $4, 60, 'UTC', 'completed') RETURNING *`,
			[U_REC, U_CAND, [U_PANEL], ja.rows[0].id]);
		const event = ev.rows[0];
		const govId = await governingSession.ensureGoverningSession(event, { callerRole: 'recruiter' });
		await consentService.recordConsent({
			sessionId: govId, candidateId: U_CAND, type: 'biometric', accepted: true, locale: 'en',
		});
		const startedAt = new Date(Date.now() + 5 * 60000);
		const decidedAt = new Date(Date.now() - 10 * 60000);
		const decisionRows = {};
		for (const [userId, decision] of Object.entries(decisions)) {
			if (!decision) continue;
			const ins = await pool.query(
				`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, decided_at, ip_address, user_agent_hash)
				 VALUES ($1, $2, $3, 'br7-1', $4, '10.0.0.9', 'ua-hash-fixture') RETURNING id`,
				[event.id, Number(userId), decision, decidedAt]);
			decisionRows[userId] = ins.rows[0].id;
		}
		const freeze = panelLabelling.computeFreeze(event);
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, interview_session_id, status, retention_expires_at, started_at, panel_expected_user_ids, panel_expected_hash)
			 VALUES ($1, NULL, 'completed', NOW() + INTERVAL '90 days', $2, $3, $4) RETURNING id`,
			[event.id, startedAt, freeze.panel_expected_user_ids, freeze.panel_expected_hash]);
		const recordingId = rec.rows[0].id;
		await pool.query(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			 VALUES ($1, 'unknown', 'hello world', 0, 1000)`, [recordingId]);
		return { event, govId, recordingId, decisionRows, startedAt };
	}

	async function claimOwnJob(enqueuedId) {
		for (let i = 0; i < 8; i++) {
			const claimed = await diarizationJobs.claim('sd19-it-worker');
			if (!claimed) return null;
			if (claimed.id === enqueuedId) return claimed;
			await worker.processJob(claimed, { runEngine: async () => ENGINE_OUTPUT });
		}
		return null;
	}

	async function latestJob(recId) {
		const { rows } = await pool.query(
			`SELECT * FROM diarization_jobs WHERE recording_id = $1 ORDER BY id DESC LIMIT 1`, [recId]);
		return rows[0];
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.JWT_SECRET = 'sd19-test-secret';
		process.env.LIVEKIT_API_KEY = 'test-key';
		process.env.LIVEKIT_API_SECRET = 'test-secret';
		process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		consentService = require('../../../lib/consentService');
		diarizationJobs = require('../../../lib/diarizationJobs');
		worker = require('../../../workers/diarization/index');
		governingSession = require('../../../lib/governingSession');
		panelLabelling = require('../../../lib/panelLabelling');
		enqueueHelper = require('../../../lib/diarizationEnqueue');
		({ erasePersonalData } = require('../../../lib/erasureService'));
		await seedUsers();
	});

	afterAll(async () => {
		await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('I1: full pass — job + run panel_consent_snapshot read back with expected set and record ids, identical', async () => {
		const { recordingId, decisionRows } = await bridgeFixture();
		const enqueued = await diarizationJobs.enqueue(recordingId);
		const job = await claimOwnJob(enqueued.id);
		expect(job).not.toBeNull();

		const result = await worker.processJob(job, { runEngine: async () => ENGINE_OUTPUT });
		expect(result.outcome).toBe('complete');

		const jobRow = await latestJob(recordingId);
		expect(jobRow.status).toBe('complete');
		expect(jobRow.panel_consent_snapshot.expected_user_ids).toEqual([U_REC, U_PANEL]);
		expect(jobRow.panel_consent_snapshot.decisions.map((d) => d.record_id).sort()).toEqual(
			[decisionRows[U_REC], decisionRows[U_PANEL]].sort(),
		);
		expect(jobRow.panel_consent_snapshot.decisions.every((d) => d.decision === 'granted')).toBe(true);

		const run = await pool.query(
			`SELECT panel_consent_snapshot FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(run.rows).toHaveLength(1);
		expect(run.rows[0].panel_consent_snapshot).toEqual(jobRow.panel_consent_snapshot);

		const seg = await pool.query(
			`SELECT speaker_number FROM interview_transcripts WHERE recording_id = $1`, [recordingId]);
		expect(seg.rows[0].speaker_number).toBe(0);
	});

	it('I2: panel decline → consent_blocked_at_claim:PANEL_AGREEMENT_DECLINED, no run, unlabelled, unavailable', async () => {
		const { recordingId } = await bridgeFixture({
			decisions: { [U_REC]: 'granted', [U_PANEL]: 'declined' },
		});
		const enqueued = await diarizationJobs.enqueue(recordingId);
		const job = await claimOwnJob(enqueued.id);
		const result = await worker.processJob(job, { runEngine: async () => ENGINE_OUTPUT });

		expect(result).toEqual({ outcome: 'cancelled_at_claim', code: 'PANEL_AGREEMENT_DECLINED' });
		const jobRow = await latestJob(recordingId);
		expect(jobRow.cancel_reason).toBe('consent_blocked_at_claim:PANEL_AGREEMENT_DECLINED');
		const runs = await pool.query(`SELECT COUNT(*)::int n FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows[0].n).toBe(0);
		const seg = await pool.query(`SELECT speaker_number FROM interview_transcripts WHERE recording_id = $1`, [recordingId]);
		expect(seg.rows[0].speaker_number).toBeNull();
		const recRow = await pool.query(`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(recRow.rows[0].diarization_status).toBe('unavailable');
	});

	it('I3: grant at claim, withdrawal before write → consent_blocked_at_write:PANEL_AGREEMENT_CHANGED, output discarded', async () => {
		const { event, recordingId } = await bridgeFixture();
		const enqueued = await diarizationJobs.enqueue(recordingId);
		const job = await claimOwnJob(enqueued.id);
		const runEngine = async () => {
			await pool.query(
				`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version)
				 VALUES ($1, $2, 'withdrawn', 'br7-1')`, [event.id, U_PANEL]);
			return ENGINE_OUTPUT;
		};
		const result = await worker.processJob(job, { runEngine });

		expect(result).toEqual({ outcome: 'cancelled_at_write', code: 'PANEL_AGREEMENT_CHANGED' });
		const jobRow = await latestJob(recordingId);
		expect(jobRow.cancel_reason).toBe('consent_blocked_at_write:PANEL_AGREEMENT_CHANGED');
		const runs = await pool.query(`SELECT COUNT(*)::int n FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows[0].n).toBe(0);
	});

	it('I4: granted → declined → granted between claim and write → still PANEL_AGREEMENT_CHANGED', async () => {
		const { event, recordingId } = await bridgeFixture();
		const enqueued = await diarizationJobs.enqueue(recordingId);
		const job = await claimOwnJob(enqueued.id);
		const runEngine = async () => {
			await pool.query(
				`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version)
				 VALUES ($1, $2, 'declined', 'br7-1')`, [event.id, U_PANEL]);
			await pool.query(
				`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version)
				 VALUES ($1, $2, 'granted', 'br7-1')`, [event.id, U_PANEL]);
			return ENGINE_OUTPUT;
		};
		const result = await worker.processJob(job, { runEngine });

		expect(result).toEqual({ outcome: 'cancelled_at_write', code: 'PANEL_AGREEMENT_CHANGED' });
		const runs = await pool.query(`SELECT COUNT(*)::int n FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows[0].n).toBe(0);
	});

	it('T13 (real DB): snapshot write-once — differing retry conflicts, stored snapshot byte-identical; requeue = new job row accepts the new snapshot', async () => {
		const { recordingId } = await bridgeFixture();
		const enqueued = await diarizationJobs.enqueue(recordingId);
		const jobRow = await latestJob(recordingId);
		const govId = jobRow.governing_session_id; // may be null pre-claim; helper takes explicit gate shape
		const snapA = {
			expected_user_ids: [U_REC, U_PANEL], expected_hash: 'hash-a',
			decisions: [{ user_id: U_REC, record_id: 1, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:00:00.000Z' }],
		};
		const snapB = { ...snapA, expected_hash: 'hash-b' };
		const gateShape = (snap) => ({
			sessionId: govId || 1, consentReceiptId: 1, eventId: 1, panelSnapshot: snap,
		});

		const first = await worker.persistClaimProvenance(enqueued.id, gateShape(snapA));
		expect(first.ok).toBe(true);
		const stored1 = await pool.query(
			`SELECT panel_consent_snapshot::text AS s FROM diarization_jobs WHERE id = $1`, [enqueued.id]);
		expect(JSON.parse(stored1.rows[0].s)).toEqual(snapA);

		const retry = await worker.persistClaimProvenance(enqueued.id, gateShape(snapB));
		expect(retry.conflict).toBe(true);
		const stored2 = await pool.query(
			`SELECT panel_consent_snapshot::text AS s FROM diarization_jobs WHERE id = $1`, [enqueued.id]);
		expect(stored2.rows[0].s).toBe(stored1.rows[0].s);

		const requeued = await diarizationJobs.enqueue(recordingId);
		expect(requeued.id).not.toBe(enqueued.id);
		const second = await worker.persistClaimProvenance(requeued.id, gateShape(snapB));
		expect(second.ok).toBe(true);
		const stored3 = await pool.query(
			`SELECT panel_consent_snapshot FROM diarization_jobs WHERE id = $1`, [requeued.id]);
		expect(stored3.rows[0].panel_consent_snapshot).toEqual(snapB);
	});

	it('I5: panel user erasure deletes their event_labelling_consent rows across ALL events; candidate erasure leaves panel rows byte-identical', async () => {
		// Panel2 holds decisions on two events.
		const evIds = [];
		for (let i = 0; i < 2; i++) {
			const ev = await pool.query(
				`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, duration_minutes, timezone, status)
				 VALUES ($1, $2, $3, 60, 'UTC', 'completed') RETURNING id`,
				[U_REC, U_CAND2, [U_PANEL2]]);
			evIds.push(ev.rows[0].id);
			await pool.query(
				`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, ip_address, user_agent_hash)
				 VALUES ($1, $2, 'granted', 'br7-1', '10.0.0.7', 'ua-i5')`, [ev.rows[0].id, U_PANEL2]);
		}
		// Candidate2's own event carries a panel row from U_PANEL (with a
		// recording, so the event is redacted not whole-deleted).
		const evC = await pool.query(
			`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, duration_minutes, timezone, status)
			 VALUES ($1, $2, $3, 60, 'UTC', 'completed') RETURNING id`,
			[U_REC, U_CAND2, [U_PANEL]]);
		await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, status, retention_expires_at)
			 VALUES ($1, 'completed', NOW() + INTERVAL '90 days')`, [evC.rows[0].id]);
		await pool.query(
			`INSERT INTO event_labelling_consent (interview_event_id, user_id, decision, notice_version, ip_address, user_agent_hash)
			 VALUES ($1, $2, 'granted', 'br7-1', '10.0.0.8', 'ua-i5b')`, [evC.rows[0].id, U_PANEL]);
		const panelRowBefore = await pool.query(
			`SELECT * FROM event_labelling_consent WHERE interview_event_id = $1 AND user_id = $2`, [evC.rows[0].id, U_PANEL]);

		async function runErasure(userId) {
			const client = new Client({ connectionString: DB_URL });
			await client.connect();
			try {
				await client.query('BEGIN');
				const result = await erasePersonalData(userId, { client });
				await client.query('COMMIT');
				return result;
			} catch (err) {
				await client.query('ROLLBACK').catch(() => {});
				throw err;
			} finally {
				await client.end();
			}
		}

		const resPanel = await runErasure(U_PANEL2);
		expect(resPanel.panelLabellingConsentDeleted).toBe(2);
		const gone = await pool.query(
			`SELECT COUNT(*)::int n FROM event_labelling_consent WHERE user_id = $1`, [U_PANEL2]);
		expect(gone.rows[0].n).toBe(0);

		await runErasure(U_CAND2);
		const panelRowAfter = await pool.query(
			`SELECT * FROM event_labelling_consent WHERE interview_event_id = $1 AND user_id = $2`, [evC.rows[0].id, U_PANEL]);
		expect(panelRowAfter.rows).toEqual(panelRowBefore.rows);
	});

	it('I7: enqueue suppression — panel decline before transcription creates NO job row, state unavailable; granted control enqueues', async () => {
		process.env.DIARIZATION_ENABLED = 'true';
		const declined = await bridgeFixture({
			decisions: { [U_REC]: 'granted', [U_PANEL]: 'declined' },
		});
		const res = await enqueueHelper.enqueueDiarizationForRecording(declined.recordingId);
		expect(res.enqueued).toBe(false);
		expect(res.code).toBe('PANEL_AGREEMENT_DECLINED');
		const jobs = await pool.query(
			`SELECT COUNT(*)::int n FROM diarization_jobs WHERE recording_id = $1`, [declined.recordingId]);
		expect(jobs.rows[0].n).toBe(0);
		const recRow = await pool.query(
			`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [declined.recordingId]);
		expect(recRow.rows[0].diarization_status).toBe('unavailable');

		const granted = await bridgeFixture();
		const res2 = await enqueueHelper.enqueueDiarizationForRecording(granted.recordingId);
		expect(res2.enqueued).toBe(true);
		const jobs2 = await pool.query(
			`SELECT COUNT(*)::int n FROM diarization_jobs WHERE recording_id = $1`, [granted.recordingId]);
		expect(jobs2.rows[0].n).toBe(1);
		const recRow2 = await pool.query(
			`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [granted.recordingId]);
		expect(recRow2.rows[0].diarization_status).toBe('pending');
		delete process.env.DIARIZATION_ENABLED;
	});

	it('I6: post-write withdrawal via the capture endpoint purges labels, keeps the claim snapshot, and bars re-enqueue', async () => {
		const express = require('express');
		const request = require('supertest');
		const { generateToken } = require('../../../lib/auth');
		const eventsRouter = require('../../../routes/interview-events');
		const livekitRouter = require('../../routes/livekit');
		const app = express();
		app.use(express.json());
		app.use('/api/interviews', eventsRouter);
		app.use('/api/livekit', livekitRouter);

		const { event, recordingId } = await bridgeFixture();
		// Completed diarization artefacts + a job carrying the claim snapshot.
		const job = await pool.query(
			`INSERT INTO diarization_jobs (recording_id, status, panel_consent_snapshot)
			 VALUES ($1, 'complete', $2::jsonb) RETURNING id`,
			[recordingId, JSON.stringify({ expected_user_ids: [U_REC, U_PANEL], decisions: [] })]);
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms)
			 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 1, '[{"speaker":0,"start_s":0,"end_s":1}]'::jsonb, 1000)`,
			[recordingId, job.rows[0].id]);
		await pool.query(
			`UPDATE interview_transcripts SET speaker_number = 0 WHERE recording_id = $1`, [recordingId]);
		await pool.query(
			`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state)
			 VALUES ($1, 0, $2, 'candidate', 'proposed')`, [recordingId, U_CAND]);
		await pool.query(
			`UPDATE interview_recordings SET diarization_status = 'complete' WHERE id = $1`, [recordingId]);
		const room = await pool.query(
			`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
			 VALUES ($1, 'room-1956-i6', 'RM_i6', 'active') RETURNING id`, [event.id]);

		const panelTok = generateToken({ id: U_PANEL, email: 'panel1956@test.local', role: 'recruiter' });
		const tokRes = await request(app).post(`/api/livekit/rooms/${room.rows[0].id}/token`)
			.set('Authorization', `Bearer ${panelTok}`).send({});
		expect(tokRes.status).toBe(200);
		const rosterVersion = tokRes.body.labelling_notice.roster_version;

		const cap = await request(app).post(`/api/interviews/events/${event.id}/labelling-consent`)
			.set('Authorization', `Bearer ${panelTok}`)
			.send({ decision: 'withdrawn', room_id: room.rows[0].id, roster_version: rosterVersion });
		expect(cap.status).toBe(200);

		const runs = await pool.query(`SELECT COUNT(*)::int n FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows[0].n).toBe(0);
		const maps = await pool.query(`SELECT COUNT(*)::int n FROM recording_speaker_mappings WHERE recording_id = $1`, [recordingId]);
		expect(maps.rows[0].n).toBe(0);
		const seg = await pool.query(`SELECT speaker_number FROM interview_transcripts WHERE recording_id = $1`, [recordingId]);
		expect(seg.rows[0].speaker_number).toBeNull();
		const recRow = await pool.query(`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(recRow.rows[0].diarization_status).toBe('unavailable');
		// Claim snapshot retained as evidence (C-2).
		const jobRow = await pool.query(`SELECT panel_consent_snapshot FROM diarization_jobs WHERE id = $1`, [job.rows[0].id]);
		expect(jobRow.rows[0].panel_consent_snapshot).toEqual({ expected_user_ids: [U_REC, U_PANEL], decisions: [] });

		// Re-enqueue barred while the withdrawal stands.
		process.env.DIARIZATION_ENABLED = 'true';
		const res = await enqueueHelper.enqueueDiarizationForRecording(recordingId);
		expect(res.enqueued).toBe(false);
		delete process.env.DIARIZATION_ENABLED;
	});
});
