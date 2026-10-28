/**
 * diarizationWorker.integration.test.js — S-D04 (#1906), HL-003 gate.
 *
 * NO mocks: the real worker + real gate + real consentService + real
 * diarizationJobs against a real Postgres (a fresh-migrated DB), with
 * resulting state read back from the DB. This is the layer the unit
 * suites cannot prove — live consent resolution (AC-5), the write-time
 * re-check (AC-4), and the flag-off claim behaviour (AC-1) against the
 * real schema (migration 296 included).
 *
 * Gated behind DIARIZATION_INTEGRATION_DB_URL (same pattern as
 * consentService.integration.test.js). DATABASE_URL must point at the
 * same DB so lib/db's pool connects to it.
 * Example:
 *   DATABASE_URL='postgresql://postgres@127.0.0.1:55433/sd04_e2e' \
 *   DIARIZATION_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd04_e2e' \
 *     npx jest server/__tests__/lib/diarizationWorker.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.DIARIZATION_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('diarization worker (real DB — S-D04)', () => {
	jest.setTimeout(30000);
	let pool;
	let consentService;
	let diarizationJobs;
	let worker;
	let candidateId;
	let recruiterId;
	let sessionId;
	let eventId;
	let recordingId;
	let unlinkedRecordingId;

	async function seedRecording({ withSession }) {
		// Migration 130: a recording is event-linked XOR session-linked.
		let evId = null;
		if (!withSession) {
			const ev = await pool.query(
				`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
				 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
				[recruiterId, candidateId],
			);
			evId = ev.rows[0].id;
		}
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, interview_session_id, status, retention_expires_at)
			 VALUES ($1, $2, 'completed', NOW() + INTERVAL '90 days') RETURNING id`,
			[evId, withSession ? sessionId : null],
		);
		await pool.query(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			 VALUES ($1, 'unknown', 'hello world', 0, 1000)`,
			[rec.rows[0].id],
		);
		return { eventId: evId, recordingId: rec.rows[0].id };
	}

	async function jobState(recId) {
		const { rows } = await pool.query(
			`SELECT status, cancel_reason, error_class FROM diarization_jobs WHERE recording_id = $1 ORDER BY id DESC LIMIT 1`,
			[recId],
		);
		return rows[0];
	}

	async function speakerNumber(recId) {
		const { rows } = await pool.query(
			`SELECT speaker_number FROM interview_transcripts WHERE recording_id = $1`,
			[recId],
		);
		return rows[0]?.speaker_number;
	}

	beforeAll(async () => {
		// server/test/setup.js overwrites DATABASE_URL with a dummy —
		// point lib/db at the real rig DB and reset modules before any
		// lib module loads its pool (consentService.integration pattern).
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		consentService = require('../../../lib/consentService');
		diarizationJobs = require('../../../lib/diarizationJobs');
		worker = require('../../../workers/diarization/index');

		const cand = await pool.query(
			`INSERT INTO users (email) VALUES ('sd04-candidate@example.test') RETURNING id`,
		);
		candidateId = cand.rows[0].id;
		const rec = await pool.query(
			`INSERT INTO users (email) VALUES ('sd04-recruiter@example.test') RETURNING id`,
		);
		recruiterId = rec.rows[0].id;
		const sess = await pool.query(
			`INSERT INTO interview_sessions (candidate_id, type, config, conversation, current_question_index)
			 VALUES ($1, 'human', '{}'::jsonb, '[]'::jsonb, 0) RETURNING id`,
			[candidateId],
		);
		sessionId = sess.rows[0].id;
		({ eventId, recordingId } = await seedRecording({ withSession: true }));
		({ recordingId: unlinkedRecordingId } = await seedRecording({ withSession: false }));
	});

	afterAll(async () => {
		await pool.query(`DELETE FROM interview_recordings WHERE id = ANY($1)`, [
			[recordingId, unlinkedRecordingId],
		]).catch(() => {});
		await pool.query(`DELETE FROM interview_events WHERE candidate_id = $1`, [candidateId]).catch(() => {});
		await pool.query(`DELETE FROM interview_sessions WHERE id = $1`, [sessionId]).catch(() => {});
		await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[candidateId, recruiterId]]).catch(() => {});
		await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('AC-1: flag OFF — poll claims nothing, the pending job stays pending', async () => {
		await consentService.recordConsent({
			sessionId, candidateId, type: 'biometric', accepted: true, locale: 'en',
		});
		await diarizationJobs.enqueue(recordingId);
		delete process.env.DIARIZATION_ENABLED;

		const result = await worker.poll();

		expect(result).toBeNull();
		expect((await jobState(recordingId)).status).toBe('pending');
	});

	it('AC-2/AC-5: granted + current at claim time — job proceeds past the gate (S-D05: real engine, no audio on this fixture → honest engine_failed)', async () => {
		// S-D04's version of this test asserted stub completion. S-D05
		// (#1907) replaced the stub with the real engine: this fixture's
		// recording has no storage path, so the audio fetch returns
		// nothing and the job must fail honestly — never fake-complete.
		// The full real-engine success path is proven in
		// diarizationEngine.integration.test.js (spike fixture).
		process.env.DIARIZATION_ENABLED = 'true';
		const job = await diarizationJobs.claim('sd04-it-worker');
		expect(job.recording_id).toBe(recordingId);
		const result = await worker.processJob(job);

		expect(result).toEqual({ outcome: 'failed', errorClass: 'engine_failed' });
		const state = await jobState(recordingId);
		expect(state.status).toBe('failed');
		expect(state.error_class).toBe('engine_failed');
		// No labels, no run row — no fake completion anywhere
		expect(await speakerNumber(recordingId)).toBeNull();
		const runs = await pool.query(
			`SELECT COUNT(*)::int AS n FROM diarization_runs WHERE recording_id = $1`,
			[recordingId],
		);
		expect(runs.rows[0].n).toBe(0);
	});

	it('AC-5/AC-3: consent withdrawn between enqueue and claim governs — cancelled at claim', async () => {
		const enqueued = await diarizationJobs.enqueue(recordingId);
		await consentService.withdrawConsent({ sessionId, candidateId, type: 'biometric' });

		// S-D05 note: the AC-2 job above now FAILS (retryable) instead of
		// stub-completing, and claim() is global/oldest-first — it may
		// hand back that retryable job first. Process whatever is
		// claimed (each cancels at the claim gate under withdrawn
		// consent) until this test's own job is the one processed.
		let result;
		for (let i = 0; i < 3; i++) {
			const claimed = await diarizationJobs.claim('sd04-it-worker');
			if (!claimed) break;
			const r = await worker.processJob(claimed);
			if (claimed.id === enqueued.id) {
				result = r;
				break;
			}
		}
		expect(result).toBeDefined();

		expect(result).toEqual({ outcome: 'cancelled_at_claim', code: 'CONSENT_WITHDRAWN' });
		const state = await jobState(recordingId);
		expect(state.status).toBe('cancelled');
		expect(state.cancel_reason).toBe('consent_blocked_at_claim:CONSENT_WITHDRAWN');
		expect(await speakerNumber(recordingId)).toBeNull();
	});

	it('AC-4: consent withdrawn after claim but before write — output discarded, cancelled at write', async () => {
		await consentService.recordConsent({
			sessionId, candidateId, type: 'biometric', accepted: true, locale: 'en',
		});
		await diarizationJobs.enqueue(recordingId);
		const job = await diarizationJobs.claim('sd04-it-worker');
		// The injected engine withdraws consent mid-run, then returns output:
		const runEngine = async () => {
			await consentService.withdrawConsent({ sessionId, candidateId, type: 'biometric' });
			return { speakerCount: 2, turns: [{ speaker: 1, start_s: 0, end_s: 1 }] };
		};

		const result = await worker.processJob(job, { runEngine });

		expect(result).toEqual({ outcome: 'cancelled_at_write', code: 'CONSENT_WITHDRAWN' });
		const state = await jobState(recordingId);
		expect(state.status).toBe('cancelled');
		expect(state.cancel_reason).toBe('consent_blocked_at_write:CONSENT_WITHDRAWN');
		expect(await speakerNumber(recordingId)).toBeNull();
	});

	it('AC-3: recording with no session link — cancelled consent_blocked_at_claim:NO_SESSION', async () => {
		await diarizationJobs.enqueue(unlinkedRecordingId);
		const job = await diarizationJobs.claim('sd04-it-worker');

		const result = await worker.processJob(job);

		expect(result).toEqual({ outcome: 'cancelled_at_claim', code: 'NO_SESSION' });
		const state = await jobState(unlinkedRecordingId);
		expect(state.cancel_reason).toBe('consent_blocked_at_claim:NO_SESSION');
	});
});
