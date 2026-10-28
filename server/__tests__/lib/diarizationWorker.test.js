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
});
