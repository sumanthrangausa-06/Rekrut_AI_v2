/**
 * observerReportStates — S-071 (#725) tests.
 *
 * TDD Red: the module does not exist yet.
 */

const {
	getSectionState,
	getReportSectionStates,
	getRecruiterObserverNotice,
	SECTION_STATES,
	BIOMETRIC_SECTIONS,
	DECLINED_COPY,
	RECRUITER_NEUTRAL_COPY,
	OBSERVER_DISABLED_COPY,
	OBSERVER_PRESENCE_COPY,
} = require('../../../lib/observerReportStates');

const declinedSession = { config: { biometric_collection: false } };
const consentedSession = { config: { biometric_collection: true } };
const unsetSession = { config: {} };

describe('observerReportStates — declined sessions (S-071)', () => {
	test.each(['vocal', 'visual', 'integrity'])(
		'declined session, %s section with no data → declined',
		(section) => {
			const result = getSectionState({ session: declinedSession, section, hasData: false });
			expect(result.state).toBe(SECTION_STATES.DECLINED);
			expect(result.label).toBe('Declined by candidate');
		}
	);

	test('declined is distinct from missing — not blank, not "data missing"', () => {
		const result = getSectionState({ session: declinedSession, section: 'vocal', hasData: false });
		expect(result.state).not.toBe(SECTION_STATES.MISSING);
		expect(result.label).not.toMatch(/missing/i);
		expect(result.label).not.toBe('');
	});

	test('declined sections carry an explanation for the recruiter (AC-2)', () => {
		const result = getSectionState({ session: declinedSession, section: 'visual', hasData: false });
		expect(result.explanation).toBeTruthy();
		expect(result.explanation).not.toMatch(/missing/i);
	});
});

describe('observerReportStates — non-declined sessions', () => {
	test('consented session with no data → missing (not declined)', () => {
		const result = getSectionState({ session: consentedSession, section: 'vocal', hasData: false });
		expect(result.state).toBe(SECTION_STATES.MISSING);
	});

	test('unset consent with no data → missing (only explicit false is declined)', () => {
		const result = getSectionState({ session: unsetSession, section: 'vocal', hasData: false });
		expect(result.state).toBe(SECTION_STATES.MISSING);
	});

	test('null session with no data → missing', () => {
		const result = getSectionState({ session: null, section: 'vocal', hasData: false });
		expect(result.state).toBe(SECTION_STATES.MISSING);
	});

	test('data present → present when consent was granted and the section is in scope', () => {
		expect(
			getSectionState({
				session: consentedSession,
				section: 'vocal',
				hasData: true,
				inDisclosureScope: true,
			}).state
		).toBe(SECTION_STATES.PRESENT);
	});

	// AMENDED by S-039 (#686, panel Q1): the state resolution order is
	// consent → disclosure scope → presence. The S-071-era expectation
	// ("present regardless of consent") is superseded: a declined session
	// must never surface biometric analysis, even if data somehow exists.
	test('declined session with data → declined (consent resolves before presence)', () => {
		expect(
			getSectionState({ session: declinedSession, section: 'vocal', hasData: true }).state
		).toBe(SECTION_STATES.DECLINED);
	});
});

describe('observerReportStates — section scoping', () => {
	test('all three biometric sections are covered', () => {
		expect(BIOMETRIC_SECTIONS).toEqual(expect.arrayContaining(['vocal', 'visual', 'integrity']));
	});

	test('non-biometric section is unaffected by a biometric decline', () => {
		const result = getSectionState({ session: declinedSession, section: 'transcript', hasData: false });
		expect(result.state).toBe(SECTION_STATES.MISSING);
	});

	test('getReportSectionStates resolves all biometric sections at once', () => {
		const states = getReportSectionStates({
			session: declinedSession,
			dataBySection: { vocal: false, visual: false, integrity: false },
		});
		expect(Object.keys(states).sort()).toEqual(['integrity', 'visual', 'vocal']);
		for (const section of BIOMETRIC_SECTIONS) {
			expect(states[section].state).toBe(SECTION_STATES.DECLINED);
		}
	});

	test('DECLINED_COPY exports the canonical label', () => {
		expect(DECLINED_COPY.label).toBe('Declined by candidate');
	});
});

describe('observerReportStates — disclosure scope (S-039, panel Q1 amendment)', () => {
	// Resolution order: consent → disclosure scope → presence.
	// Out-of-scope sections resolve to `missing`, indistinguishable from
	// genuinely absent data — suppression is never a distinct visible state.
	test('granted session with data but out of disclosure scope → missing (scope before presence)', () => {
		expect(
			getSectionState({
				session: consentedSession,
				section: 'vocal',
				hasData: true,
				inDisclosureScope: false,
			}).state
		).toBe(SECTION_STATES.MISSING);
	});

	test('declined session out of scope → declined (consent before scope)', () => {
		expect(
			getSectionState({
				session: declinedSession,
				section: 'vocal',
				hasData: true,
				inDisclosureScope: false,
			}).state
		).toBe(SECTION_STATES.DECLINED);
	});

	// Fail-closed (privacy review S-1): the scope flag has NO permissive
	// default — a caller that omits it gets suppression (missing), the same
	// posture as the consent gate's default-deny. Callers opt into scope
	// explicitly (the hiring-team-gated status channel passes true).
	test('scope flag omitted → missing even with consent and data (fail-closed default)', () => {
		expect(
			getSectionState({ session: consentedSession, section: 'visual', hasData: true }).state
		).toBe(SECTION_STATES.MISSING);
	});

	test('explicit in-scope + granted + data → present', () => {
		expect(
			getSectionState({
				session: consentedSession,
				section: 'visual',
				hasData: true,
				inDisclosureScope: true,
			}).state
		).toBe(SECTION_STATES.PRESENT);
	});

	test('getReportSectionStates threads the scope flag to every section', () => {
		const states = getReportSectionStates({
			session: consentedSession,
			dataBySection: { vocal: true, visual: true, integrity: true },
			inDisclosureScope: false,
		});
		for (const section of BIOMETRIC_SECTIONS) {
			expect(states[section].state).toBe(SECTION_STATES.MISSING);
		}
	});
});

describe('observerReportStates — DECLINED_COPY carries the no-inference clause atomically (S-039)', () => {
	// Panel ruling (audience split): where the reason IS named (candidate
	// surfaces + the hiring-team-gated audit record), the protective clause
	// is part of the canonical copy itself — never appended by a renderer.
	test('explanation carries a no-inference / not-held-against clause in the same string', () => {
		expect(DECLINED_COPY.explanation).toMatch(/held against/i);
		expect(DECLINED_COPY.explanation).toContain('declined biometric collection');
	});
});

describe('observerReportStates — recruiter-surface notice (audience split, S-039)', () => {
	// The recruiter-facing report NEVER names a candidate-side non-consent
	// reason: declined / withdrawn / unknown collapse to ONE neutral,
	// indistinguishable sentence in metadata. Employer-disabled is named
	// (the employer's own act, S-039 AC-3).
	const declinedNotice = getRecruiterObserverNotice({
		observerEnabled: true,
		consentGranted: false,
		anySectionPresent: false,
	});

	test('employer-disabled → the AC-3 message, named', () => {
		const notice = getRecruiterObserverNotice({
			observerEnabled: false,
			consentGranted: true,
			anySectionPresent: false,
		});
		expect(notice.kind).toBe('disabled');
		expect(notice.copy).toBe('AI Observer was not enabled for this session.');
		expect(OBSERVER_DISABLED_COPY).toBe('AI Observer was not enabled for this session.');
	});

	test('disabled wins even if a section somehow has data', () => {
		const notice = getRecruiterObserverNotice({
			observerEnabled: false,
			consentGranted: true,
			anySectionPresent: true,
		});
		expect(notice.kind).toBe('disabled');
	});

	test('candidate-side non-consent → ONE neutral sentence with the no-inference clause', () => {
		expect(declinedNotice.kind).toBe('neutral');
		expect(declinedNotice.copy).toBe(RECRUITER_NEUTRAL_COPY);
		expect(declinedNotice.copy).toMatch(/no inference should be drawn/i);
		// The neutral sentence must not leak the reason it collapses.
		expect(declinedNotice.copy).not.toMatch(/declin|withdraw|consent/i);
	});

	test('unknown consent produces the IDENTICAL notice (indistinguishability, panel T-16)', () => {
		const unknownNotice = getRecruiterObserverNotice({
			observerEnabled: true,
			consentGranted: false,
			anySectionPresent: false,
		});
		expect(unknownNotice).toEqual(declinedNotice);
	});

	test('a present section → no metadata notice (the analysis column speaks)', () => {
		const notice = getRecruiterObserverNotice({
			observerEnabled: true,
			consentGranted: true,
			anySectionPresent: true,
		});
		expect(notice).toEqual({ kind: 'none', copy: null });
	});

	test('granted, observer ran, no analysis sections present → presence copy', () => {
		const notice = getRecruiterObserverNotice({
			observerEnabled: true,
			consentGranted: true,
			anySectionPresent: false,
		});
		expect(notice.kind).toBe('presence');
		expect(notice.copy).toBe(OBSERVER_PRESENCE_COPY);
		expect(notice.copy).toMatch(/present with candidate consent/i);
	});
});

describe('observerReportStates — S-049a scaffold contract (live import)', () => {
	// Panel fixture regime: fixtures are pinned to the S-049a scaffold
	// shape, with one live-import contract test against the shipped
	// writer so the consumer side can never drift from the producer.
	const { buildReportSkeleton } = require('../../../lib/observerReportWriter');

	test('scaffold for a granted session resolves to missing sections + presence notice', () => {
		const session = { config: { biometric_collection: true } };
		const skeleton = buildReportSkeleton(session);
		const states = getReportSectionStates({
			session,
			dataBySection: {
				vocal: skeleton.analysis.vocal.state === 'present',
				visual: skeleton.analysis.visual.state === 'present',
				integrity: skeleton.integrity_summary.state === 'present',
			},
			inDisclosureScope: true,
		});
		for (const section of BIOMETRIC_SECTIONS) {
			expect(states[section].state).toBe(SECTION_STATES.MISSING);
		}
		expect(skeleton.integrity_summary.version).toBe(1);
		const notice = getRecruiterObserverNotice({
			observerEnabled: true,
			consentGranted: true,
			anySectionPresent: Object.values(states).some((s) => s.state === 'present'),
		});
		expect(notice.kind).toBe('presence');
	});
});
