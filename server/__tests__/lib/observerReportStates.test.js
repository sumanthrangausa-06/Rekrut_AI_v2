/**
 * observerReportStates — S-071 (#725) tests.
 *
 * TDD Red: the module does not exist yet.
 */

const {
	getSectionState,
	getReportSectionStates,
	SECTION_STATES,
	BIOMETRIC_SECTIONS,
	DECLINED_COPY,
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

	test('data present → present regardless of consent', () => {
		expect(
			getSectionState({ session: consentedSession, section: 'vocal', hasData: true }).state
		).toBe(SECTION_STATES.PRESENT);
		expect(
			getSectionState({ session: declinedSession, section: 'vocal', hasData: true }).state
		).toBe(SECTION_STATES.PRESENT);
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
