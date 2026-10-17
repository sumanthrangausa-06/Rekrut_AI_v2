/**
 * S-046 (#694) — AI Observer consent gate, default-deny amendment.
 *
 * Privacy-engineer BLOCKER (E-008 spec §3.1, Sumanth-approved 2026-10-12):
 * for biometric processing, "not declined" is NOT consent. BIPA requires a
 * written release BEFORE collection; GDPR Art. 9 requires EXPLICIT opt-in.
 *
 * The gate returns { allowed: true } ONLY when biometric_collection === true.
 * - false → blocked, BIOMETRIC_CONSENT_DECLINED (explicit decline)
 * - undefined/null/non-boolean → blocked, BIOMETRIC_CONSENT_UNKNOWN
 *   (consent never presented, legacy session, config drift)
 *
 * Pure function, no DB, no side effects. Single choke point for the
 * observer consent decision at every dispatch entry point.
 */
const {
	canEnableObserver,
	GATE_BLOCKED_CODE,
	GATE_UNKNOWN_CODE,
} = require('../../../lib/observerConsentGate');

describe('canEnableObserver (default-deny)', () => {
	test('biometric_collection === true → allowed', () => {
		const session = { id: 1, config: { biometric_collection: true } };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('biometric_collection === false → blocked with DECLINED code', () => {
		const session = { id: 1, config: { biometric_collection: false } };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe(GATE_BLOCKED_CODE);
		expect(result.code).toBe('BIOMETRIC_CONSENT_DECLINED');
		expect(typeof result.message).toBe('string');
		expect(result.message.length).toBeGreaterThan(0);
		// The message must name the cause (candidate declined) so the
		// recruiter understands why the observer was blocked.
		expect(result.message).toMatch(/declined/i);
	});

	test('biometric_collection unset → blocked with UNKNOWN code (default-deny)', () => {
		const session = { id: 1, config: {} };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe(GATE_UNKNOWN_CODE);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
		expect(typeof result.message).toBe('string');
		expect(result.message.length).toBeGreaterThan(0);
	});

	test('biometric_collection null → blocked with UNKNOWN code', () => {
		const session = { id: 1, config: { biometric_collection: null } };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('config null → blocked with UNKNOWN code', () => {
		const session = { id: 1, config: null };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('config undefined → blocked with UNKNOWN code', () => {
		const session = { id: 1 };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('null session → blocked with UNKNOWN code (fail-closed)', () => {
		const result = canEnableObserver(null);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('undefined session → blocked with UNKNOWN code (fail-closed)', () => {
		const result = canEnableObserver(undefined);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('non-boolean biometric_collection (string) → blocked with UNKNOWN code', () => {
		const session = { id: 1, config: { biometric_collection: 'true' } };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});

	test('other config keys do not affect the gate', () => {
		// observer_enabled is the recruiter toggle; the gate only reads
		// biometric_collection. Toggle ON + consent granted → allowed.
		const session = {
			id: 1,
			config: { observer_enabled: true, biometric_collection: true, some_flag: 'x' },
		};
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('toggle ON but consent unknown → blocked (gate overrides toggle)', () => {
		// The recruiter toggle (observer_enabled) is intent; the gate is
		// consent. Consent unknown blocks regardless of toggle state.
		const session = { id: 1, config: { observer_enabled: true } };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
	});
});
