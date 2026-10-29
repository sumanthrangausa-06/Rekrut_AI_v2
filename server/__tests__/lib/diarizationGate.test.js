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
jest.mock('../../../lib/panelLabelling', () => {
	const actual = jest.requireActual('../../../lib/panelLabelling');
	return { ...actual, versionInForce: jest.fn(actual.versionInForce) };
});

const db = require('../../../lib/db');
const consentService = require('../../../lib/consentService');
const panelLabelling = require('../../../lib/panelLabelling');
const { evaluateDiarizationGate } = require('../../../lib/diarizationGate');

const RECORDING = { interview_session_id: 77, interview_event_id: 55 };
const SESSION = { id: 77, config: { biometric_collection: true }, candidate_id: 1001 };
const EVENT = { candidate_id: 1001 };

// S-D19 (#1956) panel-leg fixtures: frozen set {2001 recruiter, 2002
// panel} on the recording; both granted under br7-1 (in force from
// 2026-10-29T08:00Z) before the bridge recording's start.
const PANEL_GRANTS = {
	2001: { id: 11, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' },
	2002: { id: 12, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' },
};
const PANEL_SNAPSHOT = {
	expected_user_ids: [2001, 2002],
	expected_hash: 'frozen-hash-abc',
	decisions: [
		{ user_id: 2001, record_id: 11, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' },
		{ user_id: 2002, record_id: 12, decision: 'granted', notice_version: 'br7-1', decided_at: '2026-10-29T09:30:00.000Z' },
	],
};

function mockDb({
	recording = RECORDING,
	session = SESSION,
	event = EVENT,
	jobApplication = { candidate_id: 1001 },
	receipt = { id: 4242, granted_at: '2026-10-28T09:00:00.000Z' },
	panelDecisions = PANEL_GRANTS,
	panelThrow = false,
} = {}) {
	db.query.mockImplementation(async (sql, params) => {
		if (sql.includes('FROM interview_recordings')) {
			return { rows: recording ? [recording] : [] };
		}
		if (sql.includes('FROM event_labelling_consent')) {
			if (panelThrow) throw new Error('panel read failed');
			const row = panelDecisions ? panelDecisions[params[1]] : null;
			return { rows: row ? [row] : [] };
		}
		if (sql.includes('FROM consent_receipts')) {
			return { rows: receipt ? [receipt] : [] };
		}
		if (sql.includes('FROM job_applications')) {
			return { rows: jobApplication ? [jobApplication] : [] };
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

	it('blocks NO_SESSION when the recording has no link at all, without touching consent', async () => {
		// #1925 note: the pre-bridge version of this test used an
		// event-linked recording — that posture is now the bridge path
		// and blocks NO_GOVERNING_SESSION (T2 below). NO_SESSION remains
		// the code for a recording with neither link (and for a missing
		// event row, T3).
		mockDb({ recording: { interview_session_id: null, interview_event_id: null } });

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

// ─────────────────────────────────────────────────────────────────────────────
// Event→session bridge (ADR-D06, #1925 — design §7 T1–T11)
// Event-linked recordings resolve consent via the event's GOVERNING
// session only. T11 = the whole session-linked describe above passing
// unchanged. The sibling session (id 999, same application+candidate)
// exists in T10 only as a trap: the gate must never resolve it.
// ─────────────────────────────────────────────────────────────────────────────
describe('diarizationGate — event bridge (ADR-D06, #1925)', () => {
	beforeEach(() => jest.clearAllMocks());

	const STARTED = '2026-10-29T10:00:00.000Z';
	const BRIDGE_RECORDING = {
		interview_session_id: null,
		interview_event_id: 55,
		started_at: STARTED,
		panel_expected_user_ids: [2001, 2002],
		panel_expected_hash: 'frozen-hash-abc',
	};
	const BRIDGE_EVENT = {
		id: 55,
		candidate_id: 1001,
		job_application_id: 900,
		interview_session_id: 88,
	};
	const GOVERNING = {
		id: 88,
		config: { biometric_collection: true },
		candidate_id: 1001,
		application_id: 900,
	};

	function mockBridge(overrides = {}) {
		mockDb({
			recording: BRIDGE_RECORDING,
			event: BRIDGE_EVENT,
			session: GOVERNING,
			...overrides,
		});
	}

	it('T1: pass path — governing session + valid consent + config true + grant predates recording → allowed via event_bridge (S-D19 T1: + frozen set + both panel grants → panelSnapshot returned)', async () => {
		mockBridge();
		consentService.checkConsentState.mockResolvedValue({ state: 'valid', version: '1.2' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({
			allowed: true,
			sessionId: 88,
			candidateId: 1001,
			via: 'event_bridge',
			eventId: 55,
			consentReceiptId: 4242,
			panelSnapshot: PANEL_SNAPSHOT,
		});
		expect(consentService.checkConsentState).toHaveBeenCalledWith(88, 'biometric', 1001);
		expect(consentService.checkConsentState).toHaveBeenCalledTimes(1);
	});

	it('T2: event with interview_session_id NULL → NO_GOVERNING_SESSION, consent never called', async () => {
		mockBridge({ event: { ...BRIDGE_EVENT, interview_session_id: null } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'NO_GOVERNING_SESSION' });
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T3: event row missing → NO_SESSION', async () => {
		mockBridge({ event: null });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'NO_SESSION' });
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T4: governing session row missing → NO_GOVERNING_SESSION', async () => {
		mockBridge({ session: null });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'NO_GOVERNING_SESSION' });
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T5: governing session belongs to another candidate → SESSION_BINDING_MISMATCH, consent never called', async () => {
		mockBridge({ session: { ...GOVERNING, candidate_id: 2002 } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'SESSION_BINDING_MISMATCH' });
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T6a: governing session belongs to another application → SESSION_BINDING_MISMATCH', async () => {
		mockBridge({ session: { ...GOVERNING, application_id: 901 } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.code).toBe('SESSION_BINDING_MISMATCH');
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T6b: event job_application_id NULL → SESSION_BINDING_MISMATCH', async () => {
		mockBridge({ event: { ...BRIDGE_EVENT, job_application_id: null } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.code).toBe('SESSION_BINDING_MISMATCH');
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it('T6c: job application belongs to another candidate → SESSION_BINDING_MISMATCH', async () => {
		mockBridge({ jobApplication: { candidate_id: 2002 } });

		const gate = await evaluateDiarizationGate(42);

		expect(gate.code).toBe('SESSION_BINDING_MISMATCH');
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	it.each([
		['missing', 'CONSENT_MISSING'],
		['withdrawn', 'CONSENT_WITHDRAWN'],
		['stale', 'CONSENT_VERSION_STALE'],
	])('T7: consent state %s on the governing session → %s', async (state, code) => {
		mockBridge();
		consentService.checkConsentState.mockResolvedValue({ state });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code });
	});

	it('T7b: consent check throws on the governing session → CONSENT_UNVERIFIABLE', async () => {
		mockBridge();
		consentService.checkConsentState.mockRejectedValue(new Error('db down'));

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'CONSENT_UNVERIFIABLE' });
	});

	it('T8a: valid receipt but governing config false → BIOMETRIC_CONSENT_DECLINED', async () => {
		mockBridge({ session: { ...GOVERNING, config: { biometric_collection: false } } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'BIOMETRIC_CONSENT_DECLINED' });
	});

	it('T8b: valid receipt but governing config unset → BIOMETRIC_CONSENT_UNKNOWN', async () => {
		mockBridge({ session: { ...GOVERNING, config: {} } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'BIOMETRIC_CONSENT_UNKNOWN' });
	});

	it('T9: receipt granted after the recording started → CONSENT_AFTER_RECORDING even with valid state + config true', async () => {
		mockBridge({ receipt: { id: 4243, granted_at: '2026-10-29T11:00:00.000Z' } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'CONSENT_AFTER_RECORDING' });
	});

	it('T9b: recording with started_at NULL (precedence unprovable) → CONSENT_UNVERIFIABLE', async () => {
		mockBridge({ recording: { ...BRIDGE_RECORDING, started_at: null } });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'CONSENT_UNVERIFIABLE' });
	});

	it('T10: sibling session grant does NOT authorize — governing session has none → CONSENT_MISSING, sibling never consulted', async () => {
		mockBridge();
		// The trap: session 999 (same application + candidate) would read
		// valid; the governing session 88 reads missing. Borrowing the
		// sibling's grant is the rejected design — pinned shut here.
		consentService.checkConsentState.mockImplementation(async (sessionId) =>
			sessionId === 999 ? { state: 'valid' } : { state: 'missing' },
		);

		const gate = await evaluateDiarizationGate(42);

		expect(gate).toEqual({ allowed: false, code: 'CONSENT_MISSING' });
		expect(consentService.checkConsentState).toHaveBeenCalledTimes(1);
		expect(consentService.checkConsentState).toHaveBeenCalledWith(88, 'biometric', 1001);
		expect(consentService.checkConsentState).not.toHaveBeenCalledWith(999, 'biometric', 1001);
	});

	it('T10 mirror: governing declined (config false / no grant), sibling granted → still blocks', async () => {
		mockBridge({ session: { ...GOVERNING, config: { biometric_collection: false } } });
		consentService.checkConsentState.mockImplementation(async (sessionId) =>
			sessionId === 999 ? { state: 'valid' } : { state: 'missing' },
		);

		const gate = await evaluateDiarizationGate(42);

		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('CONSENT_MISSING');
		expect(consentService.checkConsentState).toHaveBeenCalledWith(88, 'biometric', 1001);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Panel leg (BR-7 §7 P1–P6, S-D19 #1956 — design §14 T2–T12; T1 is the
// bridge pass path above, T13 is the worker snapshot suite).
// Event-bridge path ONLY; candidate codes keep precedence.
// ─────────────────────────────────────────────────────────────────────────────
describe('diarizationGate — panel leg (BR-7 §7, #1956)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Restore the real registry behaviour after any T5 mock below.
		panelLabelling.versionInForce.mockImplementation(
			jest.requireActual('../../../lib/panelLabelling').versionInForce,
		);
	});

	const STARTED = '2026-10-29T10:00:00.000Z';
	const REC = {
		interview_session_id: null,
		interview_event_id: 55,
		started_at: STARTED,
		panel_expected_user_ids: [2001, 2002],
		panel_expected_hash: 'frozen-hash-abc',
	};
	const EV = { id: 55, candidate_id: 1001, job_application_id: 900, interview_session_id: 88 };
	const GOV = { id: 88, config: { biometric_collection: true }, candidate_id: 1001, application_id: 900 };

	function mockPanel(overrides = {}) {
		mockDb({ recording: REC, event: EV, session: GOV, ...overrides });
		consentService.checkConsentState.mockResolvedValue({ state: 'valid', version: '1.2' });
	}
	const grant = (id, extra = {}) => ({
		id, decision: 'granted', notice_version: 'br7-1',
		decided_at: '2026-10-29T09:30:00.000Z', ...extra,
	});

	it('T2: one expected user with no row → PANEL_AGREEMENT_MISSING', async () => {
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: null } });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_MISSING' });
	});

	it('T3: declined → PANEL_AGREEMENT_DECLINED', async () => {
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: grant(12, { decision: 'declined' }) } });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_DECLINED' });
	});

	it('T4: withdrawn → PANEL_AGREEMENT_WITHDRAWN', async () => {
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: grant(12, { decision: 'withdrawn' }) } });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_WITHDRAWN' });
	});

	it('T5a (C-7): grant under the version in force at started_at is honoured even when a newer version is current at gate time', async () => {
		// Registry double: at recording start br7-1 was in force; the gate
		// must judge by versionInForce(started_at), never by the current
		// version (which this double reports as br7-2 via currentNoticeVersion
		// remaining real — the gate must not consult it for staleness).
		panelLabelling.versionInForce.mockReturnValue('br7-1');
		mockPanel();
		const gate = await evaluateDiarizationGate(42);
		expect(gate.allowed).toBe(true);
		expect(panelLabelling.versionInForce).toHaveBeenCalledWith(STARTED);
	});

	it('T5b (C-7): grant under a version NOT in force at started_at → PANEL_AGREEMENT_STALE', async () => {
		mockPanel({
			panelDecisions: {
				2001: grant(11, { notice_version: 'br7-0' }),
				2002: grant(12),
			},
		});
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_STALE' });
	});

	it('T6: grant decided after recording start → PANEL_AGREEMENT_AFTER_RECORDING', async () => {
		mockPanel({
			panelDecisions: {
				2001: grant(11, { decided_at: '2026-10-29T10:05:00.000Z' }),
				2002: grant(12),
			},
		});
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_AFTER_RECORDING' });
	});

	it('T6b: started_at NULL fails closed (candidate leg CONSENT_UNVERIFIABLE fires first — panel precedence unprovable either way)', async () => {
		mockPanel({ recording: { ...REC, started_at: null } });
		const gate = await evaluateDiarizationGate(42);
		expect(gate.allowed).toBe(false);
		expect(gate.code).toBe('CONSENT_UNVERIFIABLE');
	});

	it('T7: decision query throws → PANEL_AGREEMENT_UNVERIFIABLE (fail-closed)', async () => {
		mockPanel({ panelThrow: true });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_UNVERIFIABLE' });
	});

	it('T8 (snapshot authority): event roster edited after freeze — decliner removed, stranger added — outcome unchanged, stranger never queried', async () => {
		mockPanel({
			// Live event row now lists ONLY the stranger; the frozen set
			// on the recording still carries the decliner (2002).
			event: { ...EV, recruiter_id: 2001, panel_member_ids: [2999] },
			panelDecisions: { 2001: grant(11), 2002: grant(12, { decision: 'declined' }) },
		});
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_DECLINED' });
		const panelQueries = db.query.mock.calls.filter(([sql]) => sql.includes('event_labelling_consent'));
		expect(panelQueries.length).toBeGreaterThan(0);
		expect(panelQueries.map(([, p]) => p[1])).not.toContain(2999);
	});

	it('T9: panel_expected_user_ids NULL → PANEL_SET_UNRESOLVABLE; empty set → same', async () => {
		mockPanel({ recording: { ...REC, panel_expected_user_ids: null, panel_expected_hash: null } });
		expect(await evaluateDiarizationGate(42)).toEqual({ allowed: false, code: 'PANEL_SET_UNRESOLVABLE' });
		mockPanel({ recording: { ...REC, panel_expected_user_ids: [] } });
		expect(await evaluateDiarizationGate(42)).toEqual({ allowed: false, code: 'PANEL_SET_UNRESOLVABLE' });
	});

	it('T10 (precedence + independence): candidate leg fails AND panel decline exists → candidate code; panel leg never evaluated', async () => {
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: grant(12, { decision: 'declined' }) } });
		consentService.checkConsentState.mockResolvedValue({ state: 'missing' });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: false, code: 'CONSENT_MISSING' });
		const panelQueries = db.query.mock.calls.filter(([sql]) => sql.includes('event_labelling_consent'));
		expect(panelQueries).toHaveLength(0);
	});

	it('T11 (never-speaks member, P4): gate conditions on the expected set only — grant with no speaking data anywhere → allowed; no decision + no speaking data → still MISSING', async () => {
		mockPanel();
		const ok = await evaluateDiarizationGate(42);
		expect(ok.allowed).toBe(true);
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: null } });
		const blocked = await evaluateDiarizationGate(42);
		expect(blocked).toEqual({ allowed: false, code: 'PANEL_AGREEMENT_MISSING' });
	});

	it('T12: candidate id is not in the frozen set → no panel row required for them, never queried', async () => {
		mockPanel({ panelDecisions: { 2001: grant(11), 2002: grant(12), 1001: null } });
		const gate = await evaluateDiarizationGate(42);
		expect(gate.allowed).toBe(true);
		const panelQueries = db.query.mock.calls.filter(([sql]) => sql.includes('event_labelling_consent'));
		expect(panelQueries.map(([, p]) => p[1])).not.toContain(1001);
	});

	it('session path is untouched: session-linked recording never queries the panel table', async () => {
		mockDb();
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
		const gate = await evaluateDiarizationGate(42);
		expect(gate).toEqual({ allowed: true, sessionId: 77, candidateId: 1001 });
		const panelQueries = db.query.mock.calls.filter(([sql]) => sql.includes('event_labelling_consent'));
		expect(panelQueries).toHaveLength(0);
	});
});
