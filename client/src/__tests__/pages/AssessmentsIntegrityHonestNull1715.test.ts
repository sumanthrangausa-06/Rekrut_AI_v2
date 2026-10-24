/**
 * #1715 O1 — candidate assessments page: a NULL anti_cheat_score must not
 * render an integrity badge.
 *
 * Root cause (verified at origin/dev 14c55ab79): assessments.tsx rendered
 * `{r.anti_cheat_score < 80 && (<span>Integrity: {r.anti_cheat_score}%</span>)}`.
 * In JS `null < 80` is true, so an attempt whose anti-cheat was never
 * computed (NULL since migration 290 dropped the DEFAULT 100) rendered an
 * empty "Integrity: %" badge. The sibling assessment-results.tsx already
 * handles this honestly (`result.anti_cheat_score ?? null` → "Insufficient
 * data", S-111/#836).
 *
 * This page is driven by many endpoints, so — following the repo's #1613
 * source-guard precedent — this test pins the render contract in the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
	resolve(__dirname, '../../pages/candidate/assessments.tsx'),
	'utf8',
);

describe('#1715 O1 assessments.tsx integrity badge honest-null', () => {
	it('anti_cheat_score is typed number | null (NULL is a real stored state)', () => {
		expect(src).toContain('anti_cheat_score: number | null;');
	});

	it('the badge guard null-checks before comparing (null < 80 is true in JS)', () => {
		expect(src).toContain('r.anti_cheat_score != null');
		// The bare unguarded comparison must not survive in any form.
		expect(src).not.toMatch(/\{\s*r\.anti_cheat_score\s*<\s*80\s*&&/);
	});

	it('the badge still renders the real value when one was computed', () => {
		expect(src).toContain('Integrity: {r.anti_cheat_score}%');
	});
});
