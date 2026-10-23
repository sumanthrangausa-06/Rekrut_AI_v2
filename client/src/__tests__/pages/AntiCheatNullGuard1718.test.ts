/**
 * #1718 — anti_cheat_score NULL guard sweep: a NULL anti_cheat_score must
 * not render an integrity badge or fire a low-integrity warning.
 *
 * Root cause: since migration 290 dropped the DEFAULT 100, an attempt whose
 * anti-cheat was never computed stores NULL. Three pages still declared
 * `anti_cheat_score: number` and used the value unguarded:
 *  - recruiter/assessments.tsx rendered `Integrity: {r.anti_cheat_score}%`
 *    and `{a.anti_cheat_score}%` unconditionally (NULL renders an empty "%")
 *    and compared `a.anti_cheat_score < 70` (`null < 70` is true in JS, so a
 *    never-computed score fired the "Low Integrity" warning).
 *  - candidate/aptitude-test-results.tsx compared/rendered
 *    `attempt.anti_cheat_score` unguarded in the Integrity card.
 *  - candidate/aptitude-tests.tsx rendered `{r.anti_cheat_score}%` unguarded.
 *
 * Honest behaviour (mirrors the already-guarded detail view in
 * recruiter/assessments.tsx, `selectedDetail.anti_cheat_score == null`, and
 * the #1715-O1 candidate fix in candidate/assessments.tsx,
 * `r.anti_cheat_score != null && ...`): the type is `number | null`, every
 * comparison/render is guarded with `!= null`, and when NULL nothing is
 * rendered for the integrity badge — never an empty "%", never a warning.
 * A real value still renders/compares exactly as before (85 renders "85%",
 * 50 still trips the recruiter `< 70` warning).
 *
 * These pages are driven by many endpoints, so — following the repo's
 * #1613 / #1715 source-guard precedent — this test pins the render contract
 * in the page sources.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const recruiter = readFileSync(
	resolve(__dirname, '../../pages/recruiter/assessments.tsx'),
	'utf8',
);
const aptitudeResults = readFileSync(
	resolve(__dirname, '../../pages/candidate/aptitude-test-results.tsx'),
	'utf8',
);
const aptitudeTests = readFileSync(
	resolve(__dirname, '../../pages/candidate/aptitude-tests.tsx'),
	'utf8',
);

describe('#1718 recruiter/assessments.tsx anti-cheat honest-null', () => {
	it('both list types are number | null (detail type already was)', () => {
		// AssessmentResult + JobAssessmentResult + the pre-existing
		// AssessmentDetail = 3 honest-null declarations after the fix.
		const matches = recruiter.match(/anti_cheat_score: number \| null;/g) ?? [];
		expect(matches).toHaveLength(3);
		expect(recruiter).not.toContain('anti_cheat_score: number;');
	});

	it('job-assessment Integrity badge renders nothing when NULL', () => {
		expect(recruiter).toContain('r.anti_cheat_score != null');
		// The real value still renders when one was computed (e.g. 85%).
		expect(recruiter).toContain('Integrity: {r.anti_cheat_score}%');
	});

	it('Low Integrity warning null-checks before comparing (null < 70 is true in JS)', () => {
		expect(recruiter).toContain('a.anti_cheat_score != null && a.anti_cheat_score < 70');
		// The bare unguarded comparison must not survive in any form.
		expect(recruiter).not.toMatch(/\{\s*a\.anti_cheat_score\s*<\s*70\s*&&/);
	});

	it('results-list integrity value renders nothing when NULL, real value when computed', () => {
		expect(recruiter).toContain('{a.anti_cheat_score}%');
		// The render span carries its OWN != null wrapper, independent of the
		// warning guard: `a.anti_cheat_score != null` must occur at least twice
		// (warning comparison + this render wrapper). Review F1: a bare
		// toContain was satisfied by the warning guard alone, so removing only
		// this wrapper would not have failed the suite.
		const occurrences = recruiter.match(/a\.anti_cheat_score != null/g) ?? [];
		expect(occurrences.length).toBeGreaterThanOrEqual(2);
		expect(recruiter).toContain('a.anti_cheat_score != null && (');
	});

	it('the already-guarded detail view precedent is untouched', () => {
		expect(recruiter).toContain('selectedDetail.anti_cheat_score == null');
	});
});

describe('#1718 candidate/aptitude-test-results.tsx anti-cheat honest-null', () => {
	it('anti_cheat_score is typed number | null', () => {
		expect(aptitudeResults).toContain('anti_cheat_score: number | null;');
		expect(aptitudeResults).not.toContain('anti_cheat_score: number;');
	});

	it('the Integrity card renders nothing when NULL (mirrors the Percentile card guard)', () => {
		expect(aptitudeResults).toContain('attempt.anti_cheat_score != null &&');
		expect(aptitudeResults).toContain('attempt.percentile !== null');
	});

	it('the real value still renders when one was computed', () => {
		expect(aptitudeResults).toContain('{attempt.anti_cheat_score}%');
	});
});

describe('#1718 candidate/aptitude-tests.tsx anti-cheat honest-null', () => {
	it('anti_cheat_score is typed number | null', () => {
		expect(aptitudeTests).toContain('anti_cheat_score: number | null;');
		expect(aptitudeTests).not.toContain('anti_cheat_score: number;');
	});

	it('the integrity value renders nothing when NULL', () => {
		expect(aptitudeTests).toContain('r.anti_cheat_score != null');
	});

	it('the real value still renders when one was computed', () => {
		expect(aptitudeTests).toContain('{r.anti_cheat_score}%');
	});
});
