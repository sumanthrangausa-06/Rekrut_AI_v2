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

const { resolveRoles } = require('../../../workers/ai-observer/index');

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
