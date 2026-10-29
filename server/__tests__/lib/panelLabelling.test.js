/**
 * panelLabelling.test.js — S-D19 (#1956): versionInForce pre-first-version
 * fix (S-D18 review minor 6, routed into this story at STOP 1).
 *
 * Before the fix, versionInForce initialised to the first registry entry,
 * so a timestamp before br7-1's effective_from reported br7-1 as in force
 * when NO version existed. The gate (P3) judges staleness by this helper:
 * a recording that started before any notice version existed can hold no
 * valid panel grant — versionInForce must return null there, and the
 * gate's notice_version !== null comparison blocks PANEL_AGREEMENT_STALE.
 */
const {
	PANEL_LABELLING_NOTICE_VERSIONS,
	currentNoticeVersion,
	versionInForce,
} = require('../../../lib/panelLabelling');

describe('panelLabelling versionInForce (minor 6 fix, #1956)', () => {
	it('registry is monotonic with br7-1 first', () => {
		expect(PANEL_LABELLING_NOTICE_VERSIONS[0].version).toBe('br7-1');
		expect(currentNoticeVersion()).toBe(
			PANEL_LABELLING_NOTICE_VERSIONS[PANEL_LABELLING_NOTICE_VERSIONS.length - 1].version,
		);
	});

	it('returns null for a timestamp before the first version existed', () => {
		expect(versionInForce('2026-10-29T07:59:59.000Z')).toBeNull();
		expect(versionInForce('2020-01-01T00:00:00.000Z')).toBeNull();
	});

	it('returns br7-1 at and after its effective_from', () => {
		expect(versionInForce('2026-10-29T08:00:00.000Z')).toBe('br7-1');
		expect(versionInForce('2026-10-29T10:00:00.000Z')).toBe('br7-1');
		expect(versionInForce(new Date('2026-11-01T00:00:00.000Z'))).toBe('br7-1');
	});

	it('returns null for missing/unparseable timestamps (fail-closed)', () => {
		expect(versionInForce(null)).toBeNull();
		expect(versionInForce(undefined)).toBeNull();
		expect(versionInForce('not-a-date')).toBeNull();
	});

	it('two-version registry: the version in force at t wins, not the latest (C-7)', () => {
		const registry = [
			{ version: 'br7-1', effective_from: '2026-10-29T08:00:00.000Z' },
			{ version: 'br7-2', effective_from: '2026-11-05T08:00:00.000Z' },
		];
		expect(versionInForce('2026-10-30T00:00:00.000Z', registry)).toBe('br7-1');
		expect(versionInForce('2026-11-06T00:00:00.000Z', registry)).toBe('br7-2');
		expect(versionInForce('2026-10-01T00:00:00.000Z', registry)).toBeNull();
	});
});
