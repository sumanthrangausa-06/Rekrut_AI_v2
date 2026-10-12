/**
 * ai-observer worker tests — S-047 (#695)
 * Tests for role resolution (AC-2) using the REAL worker module.
 *
 * Privacy-engineer review (S-047): the previous version duplicated
 * resolveRoles inline — it tested a copy, not the code. This version
 * imports the real module (which no longer auto-starts on require).
 */

// Mock @livekit/rtc-node before requiring the worker
jest.mock('@livekit/rtc-node', () => ({
	Room: jest.fn(),
	RoomEvent: {
		TrackSubscribed: 'trackSubscribed',
		TrackPublished: 'trackPublished',
	},
}));

// Mock dependencies to prevent side effects on import
jest.mock('../../../lib/observerJobs', () => ({
	enqueue: jest.fn(),
	claim: jest.fn(),
	heartbeat: jest.fn(),
	markObserving: jest.fn(),
	markFlushing: jest.fn(),
	complete: jest.fn(),
	cancel: jest.fn(),
	fail: jest.fn(),
	recoverStale: jest.fn(),
	getStatus: jest.fn(),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/observerConsentGate', () => ({
	canEnableObserver: jest.fn(),
}));
// S-049a: the report writer + token service are mocked so processJob's
// session-end path can be tested without a DB or a LiveKit server.
jest.mock('../../../lib/observerReportWriter', () => ({
	flushReport: jest.fn(),
}));
jest.mock('../../../server/services/livekit', () => ({
	createObserverToken: jest.fn().mockResolvedValue('test-token'),
}));

const { resolveRoles } = require('../../../workers/ai-observer/index');
// let (not const): the lifecycle suite calls jest.resetModules() and must
// re-grab the fresh mock instance afterwards.
let observerJobs = require('../../../lib/observerJobs');

describe('ai-observer role resolution (AC-2)', () => {
	test('resolves candidate-{userId} as analysis target', () => {
		const participants = [
			{ identity: 'candidate-123', metadata: {} },
			{ identity: 'interviewer-456', metadata: {} },
		];

		const roles = resolveRoles(participants, {});

		expect(roles.candidate.identity).toBe('candidate-123');
		expect(roles.candidate.userId).toBe('123');
		expect(roles.interviewers).toHaveLength(1);
		expect(roles.interviewers[0].userId).toBe('456');
	});

	test('falls back to room metadata on prefix mismatch', () => {
		const participants = [
			{ identity: 'user-abc', metadata: { userId: '789' } },
			{ identity: 'interviewer-456', metadata: {} },
		];

		const roles = resolveRoles(participants, { candidateId: '789' });

		expect(roles.candidate.identity).toBe('user-abc');
		expect(roles.candidate.userId).toBe('789');
	});

	test('returns null candidate when no match and no metadata', () => {
		const participants = [
			{ identity: 'interviewer-456', metadata: {} },
		];

		const roles = resolveRoles(participants, {});

		expect(roles.candidate).toBeNull();
		expect(roles.interviewers).toHaveLength(1);
	});

	test('observer identity (ai-observer-*) is never classified as candidate', () => {
		const participants = [
			{ identity: 'ai-observer-42', metadata: {} },
			{ identity: 'candidate-123', metadata: {} },
		];

		const roles = resolveRoles(participants, {});

		expect(roles.candidate.identity).toBe('candidate-123');
		const allIdentities = [
			roles.candidate?.identity,
			...roles.interviewers.map((i) => i.identity),
		];
		expect(allIdentities).not.toContain('ai-observer-42');
	});
});

/**
 * Worker lifecycle — S-047 in-process change (Rex + Sumanth, 2026-10-12).
 * The worker runs inside the web process: server.js calls startWorker() at
 * boot. These tests verify the module does NOT auto-start on require and
 * that startWorker/stopWorker control the poll loop + sweeper.
 */
describe('ai-observer worker lifecycle (in-process)', () => {
	let worker;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		// Fresh require so timer state is isolated per test. resetModules also
		// creates fresh mock instances — re-grab observerJobs afterwards.
		jest.resetModules();
		worker = require('../../../workers/ai-observer/index');
		observerJobs = require('../../../lib/observerJobs');
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test('does not start the poll loop on require', () => {
		expect(observerJobs.claim).not.toHaveBeenCalled();
		expect(observerJobs.recoverStale).not.toHaveBeenCalled();
	});

	test('startWorker runs the initial sweep and starts poll + sweep intervals', () => {
		const timers = worker.startWorker();

		// Initial sweep runs immediately on startup
		expect(observerJobs.recoverStale).toHaveBeenCalledTimes(1);

		// Advance past one poll interval -> claim called
		jest.advanceTimersByTime(worker.POLL_INTERVAL_MS);
		expect(observerJobs.claim).toHaveBeenCalled();

		worker.stopWorker(timers);
	});

	test('stopWorker clears the intervals — polling stops', () => {
		const timers = worker.startWorker();
		const claimsBeforeStop = observerJobs.claim.mock.calls.length;

		worker.stopWorker(timers);

		jest.advanceTimersByTime(worker.POLL_INTERVAL_MS * 3 + 60000 * 3);
		expect(observerJobs.claim.mock.calls.length).toBe(claimsBeforeStop);
	});

	test('stopWorker is safe to call with no timers', () => {
		expect(() => worker.stopWorker()).not.toThrow();
		expect(() => worker.stopWorker(null)).not.toThrow();
	});
});

/**
 * Session-completion flush trigger — S-049a (#776, spec §4.4, AC-1).
 *
 * The worker has no room-disconnect session-end path (a transport drop is
 * not a session end). Instead the existing 5s consent tick watches the
 * session `status`: when it flips to 'completed', the tick leaves the room
 * and flushes the observer report — but ONLY if consent is still granted
 * (AC-3/AC-6: a revocation landing before the flush means no report).
 */
describe('ai-observer session-completion flush (S-049a AC-1)', () => {
	let worker;
	let db;
	let gate;
	let reportWriter;
	let fakeRoom;
	let sessionRow;

	const GRANTED = { allowed: true };
	const DECLINED = {
		allowed: false,
		code: 'BIOMETRIC_CONSENT_DECLINED',
		message: 'declined',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.resetModules();

		worker = require('../../../workers/ai-observer/index');
		observerJobs = require('../../../lib/observerJobs');
		db = require('../../../lib/db');
		gate = require('../../../lib/observerConsentGate');
		reportWriter = require('../../../lib/observerReportWriter');

		fakeRoom = {
			connect: jest.fn().mockResolvedValue(undefined),
			disconnect: jest.fn().mockResolvedValue(undefined),
			remoteParticipants: new Map(),
			on: jest.fn(),
		};
		require('@livekit/rtc-node').Room.mockImplementation(() => fakeRoom);

		// Gate double mirrors the real gate's semantics (explicit true only)
		gate.canEnableObserver.mockImplementation((session) =>
			session?.config?.biometric_collection === true ? GRANTED : DECLINED,
		);

		// One mutable session row drives every session SELECT in processJob
		sessionRow = {
			id: 42,
			candidate_id: 7,
			status: 'in_progress',
			config: { biometric_collection: true, livekit_room: 'room-42' },
		};
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM interview_sessions')) return { rows: [sessionRow] };
			return { rows: [] };
		});
		observerJobs.markObserving.mockResolvedValue(undefined);
		observerJobs.cancel.mockResolvedValue(undefined);
		reportWriter.flushReport.mockResolvedValue({ written: true });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('checkConsent surfaces the session status alongside the gate result', async () => {
		sessionRow = { ...sessionRow, status: 'completed' };

		const result = await worker.checkConsent(42);

		expect(result.allowed).toBe(true);
		expect(result.sessionStatus).toBe('completed');
	});

	it('session completes with consent granted → tick flushes the report, no cancel', async () => {
		await worker.processJob({ id: 9, interview_session_id: 42 });
		expect(reportWriter.flushReport).not.toHaveBeenCalled();

		// Session ends (completion route flips status) before the next tick
		sessionRow = { ...sessionRow, status: 'completed' };
		await jest.advanceTimersByTimeAsync(worker.POLL_INTERVAL_MS);

		expect(reportWriter.flushReport).toHaveBeenCalledWith({ jobId: 9, sessionId: 42 });
		expect(observerJobs.cancel).not.toHaveBeenCalled();
		expect(fakeRoom.disconnect).toHaveBeenCalled();
	});

	it('AC-6 RACE (worker arm): consent revoked before the flush tick → NO flush, job cancelled', async () => {
		await worker.processJob({ id: 9, interview_session_id: 42 });

		// Session ends AND the candidate revokes in the same window — the
		// tick must not flush a report for a revoked session.
		sessionRow = {
			...sessionRow,
			status: 'completed',
			config: { biometric_collection: false, livekit_room: 'room-42' },
		};
		await jest.advanceTimersByTimeAsync(worker.POLL_INTERVAL_MS);

		expect(reportWriter.flushReport).not.toHaveBeenCalled();
		expect(observerJobs.cancel).toHaveBeenCalled();
	});

	it('session still in progress → tick does nothing (no flush, no cancel)', async () => {
		await worker.processJob({ id: 9, interview_session_id: 42 });

		await jest.advanceTimersByTimeAsync(worker.POLL_INTERVAL_MS);

		expect(reportWriter.flushReport).not.toHaveBeenCalled();
		expect(observerJobs.cancel).not.toHaveBeenCalled();
	});
});
