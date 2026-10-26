/**
 * #1726 — anti_cheat_score NULL guard, remaining recruiter pages: a NULL
 * anti_cheat_score must not render an integrity value or fire a
 * low-integrity warning.
 *
 * Root cause: since migration 290 dropped the DEFAULT 100, an attempt whose
 * anti-cheat was never computed stores NULL. Two recruiter pages missed by
 * the #1718 sweep still declared `anti_cheat_score: number` and used the
 * value unguarded:
 *  - recruiter/aptitude-test-results.tsx exported `${a.anti_cheat_score}%`
 *    to CSV (NULL exports the literal "null%"), compared
 *    `a.anti_cheat_score < 70` (`null < 70` is true in JS, so a
 *    never-computed score fired the "Low Integrity" warning) and rendered
 *    `{a.anti_cheat_score}%` unconditionally (NULL renders an empty "%").
 *  - recruiter/job-assessment.tsx rendered
 *    `Integrity: {r.anti_cheat_score}%` unconditionally.
 *
 * Honest behaviour (mirrors the #1718 fix and the already-guarded sites in
 * the same files — the stats average `stats.avg_anti_cheat_score !== null`
 * and the CSV percentile cell `a.percentile !== null ? ... : 'N/A'` in
 * aptitude-test-results.tsx): the type is `number | null`, every
 * comparison/render is guarded with `!= null`, and when NULL nothing is
 * rendered for the integrity value — the CSV cell exports 'N/A' exactly
 * like the percentile cell beside it. A real value still renders/compares
 * exactly as before (85 renders "85%", 50 still trips the `< 70` warning,
 * and a genuine 0 still renders "0%" and still warns — the guard
 * distinguishes null from 0).
 *
 * These pages are driven by many endpoints, so — following the repo's
 * #1613 / #1715 / #1718 source-guard precedent — this test pins the render
 * contract in the page sources, with a per-site occurrence count so that
 * removing any single guard fails the suite (the #1718 review-F1 lesson).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const aptitudeResults = readFileSync(
	resolve(__dirname, '../../pages/recruiter/aptitude-test-results.tsx'),
	'utf8',
);
const jobAssessment = readFileSync(
	resolve(__dirname, '../../pages/recruiter/job-assessment.tsx'),
	'utf8',
);

describe('#1726 recruiter/aptitude-test-results.tsx anti-cheat honest-null', () => {
	it('AttemptResult type is number | null', () => {
		// After the fix there are 2 `anti_cheat_score: number | null;`
		// declarations: AttemptResult plus the pre-existing TestStats
		// `avg_anti_cheat_score` (matched as a substring). Before the fix
		// only the avg declaration matches.
		const matches = aptitudeResults.match(/anti_cheat_score: number \| null;/g) ?? [];
		expect(matches).toHaveLength(2);
		expect(aptitudeResults).not.toContain('anti_cheat_score: number;');
	});

	it('CSV export writes N/A when NULL instead of the literal null%', () => {
		expect(aptitudeResults).toContain(
			"a.anti_cheat_score != null ? `${a.anti_cheat_score}%` : 'N/A'",
		);
		// The bare unguarded CSV cell must not survive in any form.
		expect(aptitudeResults).not.toMatch(/^\s*`\$\{a\.anti_cheat_score\}%`,/m);
	});

	it('Low Integrity warning null-checks before comparing (null < 70 is true in JS)', () => {
		expect(aptitudeResults).toContain('a.anti_cheat_score != null && a.anti_cheat_score < 70');
		// The bare unguarded comparison must not survive in any form.
		expect(aptitudeResults).not.toMatch(/\{\s*a\.anti_cheat_score\s*<\s*70\s*&&/);
	});

	it('results-list integrity value renders nothing when NULL, real value when computed', () => {
		expect(aptitudeResults).toContain('{a.anti_cheat_score}%');
		expect(aptitudeResults).toContain('a.anti_cheat_score != null && (');
		// Every consumer carries its OWN guard: `a.anti_cheat_score != null`
		// occurs 3 times (CSV ternary + warning comparison + render
		// wrapper). A bare toContain would be satisfied by any one of them,
		// so the count pins each site independently.
		const occurrences = aptitudeResults.match(/a\.anti_cheat_score != null/g) ?? [];
		expect(occurrences).toHaveLength(3);
	});

	it('the already-guarded precedents in the same file are untouched', () => {
		expect(aptitudeResults).toContain('stats.avg_anti_cheat_score !== null');
		expect(aptitudeResults).toContain("a.percentile !== null ? `${a.percentile}%` : 'N/A'");
	});
});

describe('#1726 recruiter/job-assessment.tsx anti-cheat honest-null', () => {
	it('anti_cheat_score is typed number | null', () => {
		const matches = jobAssessment.match(/anti_cheat_score: number \| null;/g) ?? [];
		expect(matches).toHaveLength(1);
		expect(jobAssessment).not.toContain('anti_cheat_score: number;');
	});

	it('Integrity badge renders nothing when NULL', () => {
		expect(jobAssessment).toContain('r.anti_cheat_score != null && (');
		const occurrences = jobAssessment.match(/r\.anti_cheat_score != null/g) ?? [];
		expect(occurrences).toHaveLength(1);
	});

	it('the real value still renders when one was computed', () => {
		expect(jobAssessment).toContain('Integrity: {r.anti_cheat_score}%');
	});
});
