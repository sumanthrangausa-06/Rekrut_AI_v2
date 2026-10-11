/**
 * S-070 (#724) — AI Observer consent gate policy (RED).
 *
 * Pure function, no DB, no side effects. Single choke point for the
 * observer consent decision: when a candidate declined biometric
 * collection (biometric_collection === false), the AI observer must not
 * join the room — no job enqueued, no audio/video streams.
 *
 * Option A (Sumanth decision 2026-10-10): structural guarantee — the
 * observer never receives the streams, so it cannot process them.
 */
const { canEnableObserver, GATE_BLOCKED_CODE } = require('../../../lib/observerConsentGate');

describe('canEnableObserver', () => {
	test('biometric_collection === false → blocked with coded error', () => {
		const session = { id: 1, config: { biometric_collection: false } };
		const result = canEnableObserver(session);
		expect(result.allowed).toBe(false);
		expect(result.code).toBe(GATE_BLOCKED_CODE);
		expect(result.code).toBe('BIOMETRIC_CONSENT_DECLINED');
		expect(typeof result.message).toBe('string');
		expect(result.message.length).toBeGreaterThan(0);
	});

	test('biometric_collection === true → allowed', () => {
		const session = { id: 1, config: { biometric_collection: true } };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('biometric_collection unset → allowed (AC-3: works as currently specified)', () => {
		const session = { id: 1, config: {} };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('config null → allowed', () => {
		const session = { id: 1, config: null };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('config undefined → allowed', () => {
		const session = { id: 1 };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('null session → allowed (route 404s on missing sessions before the gate)', () => {
		expect(canEnableObserver(null)).toEqual({ allowed: true });
	});

	test('undefined session → allowed', () => {
		expect(canEnableObserver(undefined)).toEqual({ allowed: true });
	});

	test('other config keys do not affect the gate', () => {
		const session = { id: 1, config: { observer_enabled: true, some_flag: 'x' } };
		expect(canEnableObserver(session)).toEqual({ allowed: true });
	});

	test('blocked message explains the decline (AC-2: toggle forced off with explanation)', () => {
		const session = { id: 1, config: { biometric_collection: false } };
		const result = canEnableObserver(session);
		// The message must name the cause (candidate declined) so the
		// recruiter understands why the toggle was forced off.
		expect(result.message).toMatch(/declined/i);
	});
});
