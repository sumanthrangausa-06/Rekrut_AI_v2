/**
 * diarizationWorker.test.js — S-D04 (#1906)
 * Worker skeleton (workers/diarization/): enablement flag, claim-time
 * consent gate, write-time re-check, stub engine seam.
 *
 * AC map: AC-1 flag off claims nothing · AC-2 granted+current proceeds
 * past the gate · AC-3 every blocked posture cancels
 * `consent_blocked_at_claim:<CODE>` with NO engine spawn (the stub
 * engine stands in for the S-D05 child process, which is also where
 * audio fetching will live — the skeleton has no audio path at all
 * before the gate) · AC-4 withdrawal before write cancels
 * `consent_blocked_at_write:<CODE>` and discards output · AC-5 consent
 * is resolved live at claim/write — never enqueue-time, never a job-row
 * or client field.
 *
 * The gate module and observer gate are REAL; db, the queue, the flag
 * and consentService are test doubles.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/diarizationJobs', () => ({
	claim: jest.fn(),
	cancel: jest.fn(),
	markProcessing: jest.fn(),
	complete: jest.fn(),
	fail: jest.fn(),
	heartbeat: jest.fn(),
	recoverStale: jest.fn(),
	enqueue: jest.fn(),
	getStatus: jest.fn(),
}));
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
}));
jest.mock('../../../lib/diarizationFlag', () => ({
	isDiarizationEnabled: jest.fn(),
}));

const db = require('../../../lib/db');
const diarizationJobs = require('../../../lib/diarizationJobs');
const consentService = require('../../../lib/consentService');
const { isDiarizationEnabled } = require('../../../lib/diarizationFlag');
const worker = require('../../../workers/diarization/index');

const JOB = { id: 9, recording_id: 42, status: 'claimed' };

function mockDb({ sessionConfig = { biometric_collection: true } } = {}) {
	db.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM interview_recordings')) {
			return { rows: [{ interview_session_id: 77, interview_event_id: 55 }] };
		}
		if (sql.includes('FROM interview_sessions')) {
			return { rows: [{ id: 77, config: sessionConfig, candidate_id: 1001 }] };
		}
		if (sql.includes('FROM interview_events')) {
			return { rows: [{ candidate_id: 1001 }] };
		}
		if (sql.includes('UPDATE interview_recordings')) return { rowCount: 1 };
		return { rows: [] };
	});
}

describe('diarization worker (S-D04)', () => {
	let logSpy;
	beforeEach(() => {
		jest.clearAllMocks();
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		mockDb();
		diarizationJobs.cancel.mockResolvedValue(1);
		diarizationJobs.markProcessing.mockResolvedValue(1);
		diarizationJobs.complete.mockResolvedValue(1);
		isDiarizationEnabled.mockReturnValue(true);
	});
	afterEach(() => logSpy.mockRestore());

	describe('AC-1: DIARIZATION_ENABLED off', () => {
		it('poll claims nothing when the flag is off', async () => {
			isDiarizationEnabled.mockReturnValue(false);

			const result = await worker.poll();

			expect(result).toBeNull();
			expect(diarizationJobs.claim).not.toHaveBeenCalled();
		});
	});

	describe('AC-2: granted + current at claim time proceeds past the gate', () => {
		it('runs the stub engine and completes the job; consent checked at claim AND write', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn().mockResolvedValue({ speakerCount: 0, turns: [] });

			const result = await worker.processJob(JOB, { runEngine });

			expect(result.outcome).toBe('complete');
			expect(runEngine).toHaveBeenCalledTimes(1);
			expect(diarizationJobs.markProcessing).toHaveBeenCalledWith(9);
			expect(diarizationJobs.complete).toHaveBeenCalledWith(9);
			expect(diarizationJobs.cancel).not.toHaveBeenCalled();
			// Live resolution at claim and again at write (AC-5 shape)
			expect(consentService.checkConsentState).toHaveBeenCalledTimes(2);
			expect(consentService.checkConsentState).toHaveBeenCalledWith(77, 'biometric', 1001);
		});
	});

	describe('AC-3: blocked at claim', () => {
		it.each([
			['missing', 'consent_blocked_at_claim:CONSENT_MISSING'],
			['withdrawn', 'consent_blocked_at_claim:CONSENT_WITHDRAWN'],
			['stale', 'consent_blocked_at_claim:CONSENT_VERSION_STALE'],
		])('consent %s → cancel %s, no engine spawn, log asserted', async (state, reason) => {
			consentService.checkConsentState.mockResolvedValue({ state });
			const runEngine = jest.fn();

			const result = await worker.processJob(JOB, { runEngine });

			expect(result).toEqual({ outcome: 'cancelled_at_claim', code: reason.split(':')[1] });
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(9, reason);
			expect(runEngine).not.toHaveBeenCalled();
			expect(diarizationJobs.markProcessing).not.toHaveBeenCalled();
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
			const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(logs).toContain('[diarization]');
			expect(logs).toContain('consent blocked at claim');
			expect(logs).toContain(reason.split(':')[1]);
		});

		it('no session link → consent_blocked_at_claim:NO_SESSION, no engine spawn', async () => {
			db.query.mockImplementation(async (sql) => {
				if (sql.includes('FROM interview_recordings')) {
					return { rows: [{ interview_session_id: null, interview_event_id: 55 }] };
				}
				return { rows: [] };
			});
			const runEngine = jest.fn();

			const result = await worker.processJob(JOB, { runEngine });

			expect(result.code).toBe('NO_SESSION');
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(
				9,
				'consent_blocked_at_claim:NO_SESSION',
			);
			expect(runEngine).not.toHaveBeenCalled();
			expect(consentService.checkConsentState).not.toHaveBeenCalled();
		});

		it('Tier 0 objection (session config declined) → consent_blocked_at_claim:BIOMETRIC_CONSENT_DECLINED', async () => {
			mockDb({ sessionConfig: { biometric_collection: false } });
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn();

			const result = await worker.processJob(JOB, { runEngine });

			expect(result.code).toBe('BIOMETRIC_CONSENT_DECLINED');
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(
				9,
				'consent_blocked_at_claim:BIOMETRIC_CONSENT_DECLINED',
			);
			expect(runEngine).not.toHaveBeenCalled();
		});
	});

	describe('AC-4: consent withdrawn after claim, before write', () => {
		it('discards stub output, cancels consent_blocked_at_write:CONSENT_WITHDRAWN, never completes', async () => {
			consentService.checkConsentState
				.mockResolvedValueOnce({ state: 'valid' })
				.mockResolvedValueOnce({ state: 'withdrawn', withdrawnAt: new Date() });
			const runEngine = jest.fn().mockResolvedValue({ speakerCount: 2, turns: [{ speaker: 1 }] });

			const result = await worker.processJob(JOB, { runEngine });

			expect(result).toEqual({ outcome: 'cancelled_at_write', code: 'CONSENT_WITHDRAWN' });
			expect(runEngine).toHaveBeenCalledTimes(1); // ran, output discarded
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(
				9,
				'consent_blocked_at_write:CONSENT_WITHDRAWN',
			);
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
		});
	});

	describe('AC-5: claim-time value governs — never enqueue-time, never a client field', () => {
		it('consent granted at enqueue but withdrawn before claim → blocked at claim', async () => {
			// "Enqueue-time" state was valid; the worker must not use it.
			// The only consent source is the live check at claim time:
			consentService.checkConsentState.mockResolvedValue({ state: 'withdrawn' });
			const runEngine = jest.fn();
			// Even a job row smuggling a client-supplied consent field is ignored:
			const jobWithClientField = { ...JOB, consent: 'granted', biometric_consent: true };

			const result = await worker.processJob(jobWithClientField, { runEngine });

			expect(result.outcome).toBe('cancelled_at_claim');
			expect(runEngine).not.toHaveBeenCalled();
			expect(consentService.checkConsentState).toHaveBeenCalledTimes(1);
		});
	});

	describe('poll', () => {
		it('claims and processes the next job when enabled', async () => {
			diarizationJobs.claim.mockResolvedValue(JOB);
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn().mockResolvedValue({ speakerCount: 0, turns: [] });

			const result = await worker.poll({ runEngine });

			expect(diarizationJobs.claim).toHaveBeenCalledWith(worker.WORKER_ID);
			expect(result.outcome).toBe('complete');
		});

		it('returns null when no job is claimable', async () => {
			diarizationJobs.claim.mockResolvedValue(null);
			expect(await worker.poll()).toBeNull();
		});
	});

	describe('S-D05 (#1907): real engine output, run-row persistence, failure taxonomy', () => {
		const ENGINE_OUTPUT = {
			speakerCount: 2,
			turns: [
				{ speaker: 0, start_s: 0, end_s: 8.3 },
				{ speaker: 1, start_s: 8.7, end_s: 23.8 },
			],
			engine: {
				package: '@desert-ant-labs/who',
				sdkVersion: '4.2.1',
				modelVersion: 'v0.3.4',
			},
		};

		function runRowInsert() {
			return db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO diarization_runs'));
		}

		it('hands the engine output verbatim to the stitch behind the write gate (S-D07)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			diarizationJobs.fail.mockResolvedValue(1);
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			// S-D07: run-row insert + segment labels + status flip + job
			// completion are the stitch's ONE transaction — the worker
			// must not also complete the job itself (DB review, #1909).
			const persistStitch = jest.fn().mockResolvedValue({ outcome: 'complete', runId: 5, coverageEndMs: 23800 });

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result.outcome).toBe('complete');
			expect(persistStitch).toHaveBeenCalledWith({
				jobId: 9,
				recordingId: 42,
				expectedSegmentIds: [], // the db double seeds no segments
				output: ENGINE_OUTPUT, // verbatim — turns + versions untouched
			});
			expect(runRowInsert()).toBeUndefined(); // no separate non-atomic insert
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
			expect(diarizationJobs.fail).not.toHaveBeenCalled();
		});

		it('stale stitch outcome → superseded, job NOT failed or completed by the worker (S-D07 AC-4)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			const persistStitch = jest.fn().mockResolvedValue({ outcome: 'superseded' });

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result.outcome).toBe('superseded');
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
			expect(diarizationJobs.fail).not.toHaveBeenCalled();
		});

		it('stitch throw → job failed retryably, no completion (S-D07 AC-5)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			diarizationJobs.fail.mockResolvedValue(1);
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			const persistStitch = jest.fn().mockRejectedValue(new Error('deadlock detected'));

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result).toEqual({ outcome: 'failed', errorClass: 'engine_failed' });
			expect(diarizationJobs.fail).toHaveBeenCalledWith(9, 'engine_failed', 'deadlock detected');
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
		});

		it('consent withdrawn at write → engine output discarded, NO run row', async () => {
			consentService.checkConsentState
				.mockResolvedValueOnce({ state: 'valid' })
				.mockResolvedValueOnce({ state: 'withdrawn', withdrawnAt: new Date() });
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);

			const result = await worker.processJob(JOB, { runEngine });

			expect(result.outcome).toBe('cancelled_at_write');
			expect(runRowInsert()).toBeUndefined();
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
		});

		it.each([
			['decode_failed'],
			['engine_timeout'],
			['engine_oom'],
			['engine_failed'],
		])('engine error %s → job failed with that class, no run row, no completion', async (errorClass) => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			diarizationJobs.fail.mockResolvedValue(1);
			const err = new Error(`boom (${errorClass})`);
			err.errorClass = errorClass;
			const runEngine = jest.fn().mockRejectedValue(err);

			const result = await worker.processJob(JOB, { runEngine });

			expect(result).toEqual({ outcome: 'failed', errorClass });
			expect(diarizationJobs.fail).toHaveBeenCalledWith(9, errorClass, err.message);
			expect(runRowInsert()).toBeUndefined();
			expect(diarizationJobs.complete).not.toHaveBeenCalled();
			// recording status flipped to 'failed' (honest internal state)
			const statusUpdate = db.query.mock.calls.find(
				([sql, params]) =>
					sql.includes('UPDATE interview_recordings') && params?.[1] === 'failed',
			);
			expect(statusUpdate).toBeDefined();
		});

		it('unclassified engine error defaults to engine_failed', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			diarizationJobs.fail.mockResolvedValue(1);
			const runEngine = jest.fn().mockRejectedValue(new Error('mystery'));

			const result = await worker.processJob(JOB, { runEngine });

			expect(result).toEqual({ outcome: 'failed', errorClass: 'engine_failed' });
		});
	});

	describe('#1925 bridge: event-linked job — provenance at claim, governing ids to the stitch', () => {
		const ENGINE_OUTPUT = {
			speakerCount: 1,
			turns: [{ speaker: 0, start_s: 0, end_s: 1 }],
			engine: { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' },
		};

		function mockBridgeDb() {
			db.query.mockImplementation(async (sql, params) => {
				if (sql.includes('FROM interview_recordings')) {
					return {
						rows: [{
							interview_session_id: null,
							interview_event_id: 55,
							started_at: '2026-10-29T10:00:00.000Z',
							// S-D19 (#1956): frozen panel set + grants so the
							// panel leg passes on this fixture.
							panel_expected_user_ids: [2001],
							panel_expected_hash: 'frozen-hash-abc',
						}],
					};
				}
				if (sql.includes('FROM event_labelling_consent')) {
					return {
						rows: params[1] === 2001
							? [{ id: 11, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' }]
							: [],
					};
				}
				if (sql.includes('FROM interview_events')) {
					return {
						rows: [{ id: 55, candidate_id: 1001, job_application_id: 900, interview_session_id: 88 }],
					};
				}
				if (sql.includes('FROM interview_sessions')) {
					return {
						rows: [{ id: 88, config: { biometric_collection: true }, candidate_id: 1001, application_id: 900 }],
					};
				}
				if (sql.includes('FROM job_applications')) {
					return { rows: [{ candidate_id: 1001 }] };
				}
				if (sql.includes('FROM consent_receipts')) {
					return { rows: [{ id: 4242, granted_at: '2026-10-28T09:00:00.000Z' }] };
				}
				if (sql.includes('UPDATE diarization_jobs')) return { rows: [], rowCount: 1 };
				return { rows: [] };
			});
		}

		it('persists governing_session_id + consent_receipt_id on the job at claim and passes them to persistStitch', async () => {
			mockBridgeDb();
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			const persistStitch = jest.fn().mockResolvedValue({ outcome: 'complete', runId: 7 });

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result.outcome).toBe('complete');
			const provenanceWrite = db.query.mock.calls.find(
				([sql]) => sql.includes('UPDATE diarization_jobs') && sql.includes('governing_session_id'),
			);
			expect(provenanceWrite).toBeDefined();
			expect(provenanceWrite[1]).toEqual([9, 88, 4242]);
			expect(persistStitch).toHaveBeenCalledWith(
				expect.objectContaining({ governingSessionId: 88, consentReceiptId: 4242 }),
			);
		});

		it('governing session changes between claim and write → cancelled_at_write:SESSION_BINDING_MISMATCH', async () => {
			mockBridgeDb();
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			// Second gate evaluation (write time) resolves a DIFFERENT
			// governing session (89) than claim time (88).
			let sessionReads = 0;
			const baseImpl = db.query.getMockImplementation();
			db.query.mockImplementation(async (sql, params) => {
				if (sql.includes('FROM interview_events')) {
					sessionReads += 1;
					return {
						rows: [{
							id: 55,
							candidate_id: 1001,
							job_application_id: 900,
							interview_session_id: sessionReads === 1 ? 88 : 89,
						}],
					};
				}
				if (sql.includes('FROM interview_sessions')) {
					return {
						rows: [{
							id: params[0],
							config: { biometric_collection: true },
							candidate_id: 1001,
							application_id: 900,
						}],
					};
				}
				return baseImpl(sql, params);
			});
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			const persistStitch = jest.fn();

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result).toEqual({ outcome: 'cancelled_at_write', code: 'SESSION_BINDING_MISMATCH' });
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(
				9,
				'consent_blocked_at_write:SESSION_BINDING_MISMATCH',
			);
			expect(persistStitch).not.toHaveBeenCalled();
		});

		it('S-D19: claim persists the panel snapshot write-once on the job and passes it to persistStitch', async () => {
			mockBridgeDb();
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const runEngine = jest.fn().mockResolvedValue(ENGINE_OUTPUT);
			const persistStitch = jest.fn().mockResolvedValue({ outcome: 'complete', runId: 7 });

			const result = await worker.processJob(JOB, { runEngine, persistStitch });

			expect(result.outcome).toBe('complete');
			const snapWrite = db.query.mock.calls.find(
				([sql]) => sql.includes('panel_consent_snapshot') && sql.includes('IS NULL'),
			);
			expect(snapWrite).toBeDefined();
			const stored = JSON.parse(snapWrite[1][1]);
			expect(stored.expected_user_ids).toEqual([2001]);
			expect(stored.expected_hash).toBe('frozen-hash-abc');
			expect(stored.decisions).toEqual([
				{ user_id: 2001, record_id: 11, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' },
			]);
			expect(persistStitch).toHaveBeenCalledWith(
				expect.objectContaining({ panelConsentSnapshot: stored }),
			);
		});

		it('T13 (S-2): a claim retry whose stored snapshot differs fails PANEL_SNAPSHOT_CONFLICT and never overwrites it', async () => {
			mockBridgeDb();
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			const baseImpl = db.query.getMockImplementation();
			const existingSnapshot = {
				expected_user_ids: [2001],
				expected_hash: 'frozen-hash-abc',
				decisions: [
					{ user_id: 2001, record_id: 99, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:31:00.000Z' },
				],
			};
			let snapshotWrites = 0;
			db.query.mockImplementation(async (sql, params) => {
				if (sql.includes('panel_consent_snapshot') && sql.includes('IS NULL')) {
					snapshotWrites += 1;
					return { rows: [], rowCount: 0 }; // guard: already written
				}
				if (sql.includes('SELECT panel_consent_snapshot FROM diarization_jobs')) {
					return { rows: [{ panel_consent_snapshot: existingSnapshot }] };
				}
				return baseImpl(sql, params);
			});
			const runEngine = jest.fn();

			const result = await worker.processJob(JOB, { runEngine });

			expect(result).toEqual({ outcome: 'cancelled_at_claim', code: 'PANEL_SNAPSHOT_CONFLICT' });
			expect(diarizationJobs.cancel).toHaveBeenCalledWith(
				9,
				'consent_blocked_at_claim:PANEL_SNAPSHOT_CONFLICT',
			);
			expect(runEngine).not.toHaveBeenCalled();
			// Exactly one guarded write attempt; no unguarded overwrite exists.
			expect(snapshotWrites).toBe(1);
			const unguarded = db.query.mock.calls.filter(
				([sql]) => sql.includes('panel_consent_snapshot') && sql.includes('UPDATE') && !sql.includes('IS NULL'),
			);
			expect(unguarded).toHaveLength(0);
		});
	});
});
