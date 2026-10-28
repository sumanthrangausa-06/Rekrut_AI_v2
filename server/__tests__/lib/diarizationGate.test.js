/**
 * diarizationGate.test.js — S-D04 (#1906)
 * The claim-time consent gate (Architecture §3.4, §6.1 BR-2/BR-3):
 * live DB consent via consentService + canEnableObserver as the second
 * check. Fail-closed on every ambiguity. The observer gate itself is
 * the REAL pure module — only the DB and consentService are doubled.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
}));

const db = require('../../../lib/db');
const consentService = require('../../../lib/consentService');
const { evaluateDiarizationGate } = require('../../../lib/diarizationGate');

const RECORDING = { interview_session_id: 77, interview_event_id: 55 };
const SESSION = { id: 77, config: { biometric_collection: true }, candidate_id: 1001 };
const EVENT = { candidate_id: 1001 };

function mockDb({ recording = RECORDING, session = SESSION, event = EVENT } = {}) {
	db.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM interview_recordings')) {
			return { rows: recording ? [recording] : [] };
		}
		if (sql.includes('FROM interview_sessions')) {
			return { rows: session ? [session] : [] };
		}
		if (sql.includes('FROM interview_events')) {
			return { rows: event ? [event] : [] };
		}
		return { rows: [] };
	});
}

describe('diarizationGate (§3.4)', () => {
	beforeEach(() => jest.clearAllMocks());

	it('allows when biometric consent is granted+current AND the observer gate allows', async () => {
		mockDb();
		consentService.checkConsentState.mockResolvedValue({ state: 'valid', version: '1.1' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: true, sessionId: 77, candidateId: 1001 });
		// Live, candidate-bound resolution — never a client field
		expect(consentService.checkConsentState).toHaveBeenCalledWith(77, 'biometric', 1001);
	});

	it('blocks NO_SESSION when the recording has no session link, without touching consent', async () => {
		mockDb({ recording: { interview_session_id: null, interview_event_id: 55 } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('NO_SESSION');
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('blocks NO_SESSION when the recording does not exist', async () => {
		mockDb({ recording: null });
		const gate = await evaluateDiarizationGate(999);
		expect(gate.code).toBe('NO_SESSION');
	});

	it('blocks NO_SESSION when the linked session row is gone', async () => {
		mockDb({ session: null });
		const gate = await evaluateDiarizationGate(42);
		expect(gate.code).toBe('NO_SESSION');
	});

	it('binds the candidate from the session row (session-linked recordings carry no event)', async () => {
		mockDb({ recording: { interview_session_id: 77, interview_event_id: null } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: true, sessionId: 77, candidateId: 1001 });
		expect(consentService.checkConsentState).toHaveBeenCalledWith(77, 'biometric', 1001);
	});

	it('falls back to the event candidate when the session carries none', async () => {
		mockDb({ session: { id: 77, config: { biometric_collection: true }, candidate_id: null } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: true, sessionId: 77, candidateId: 1001 });
	});

	it('blocks NO_SESSION when no candidate can be resolved from session or event', async () => {
		mockDb({
			session: { id: 77, config: { biometric_collection: true }, candidate_id: null },
			event: null,
		});
		const gate = await evaluateDiarizationGate(42);
		expect(gate.code).toBe('NO_SESSION');
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it.each([
		['missing', 'CONSENT_MISSING'],
		['withdrawn', 'CONSENT_WITHDRAWN'],
		['stale', 'CONSENT_VERSION_STALE'],
	])('blocks %s consent with code %s', async (state, code) => {
		mockDb();
		consentService.checkConsentState.mockResolvedValue({ state });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe(code);
	});

	it('fails closed (CONSENT_UNVERIFIABLE) when the live consent check throws', async () => {
		mockDb();
		consentService.checkConsentState.mockRejectedValue(new Error('db down'));

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('CONSENT_UNVERIFIABLE');
	});

	it('second check: valid DB consent but session config declined (Tier 0) → BIOMETRIC_CONSENT_DECLINED', async () => {
		mockDb({ session: { id: 77, config: { biometric_collection: false } } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('BIOMETRIC_CONSENT_DECLINED');
	});

	it('second check: valid DB consent but no session-config grant (Tier 1+2 posture) → BIOMETRIC_CONSENT_UNKNOWN', async () => {
		mockDb({ session: { id: 77, config: {} } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});
});
