/**
 * #1613 client sibling — the admin compliance overrides tables render
 * `aiConfidence` from GET /admin/compliance/overrides, which is null when
 * no AI confidence was recorded (server now writes null instead of a
 * fabricated 0.85). Before this fix both pages declared
 * `aiConfidence: number` and rendered `Math.round(o.aiConfidence * 100)%`
 * unguarded — null * 100 = 0, i.e. a fabricated "0%".
 *
 * Honest behaviour: type is `number | null`, a null renders "N/A", and
 * the Avg AI Confidence card in compliance.tsx averages only recorded
 * values (rendering "N/A" when none were recorded).
 *
 * These are full admin pages driven by many endpoints, so — following
 * the repo's source-guard precedent — this test pins the render contract
 * in the page sources.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pages = {
	'compliance.tsx': readFileSync(resolve(__dirname, '../../pages/admin/compliance.tsx'), 'utf8'),
	'EUAIActDashboard.tsx': readFileSync(
		resolve(__dirname, '../../pages/admin/compliance/EUAIActDashboard.tsx'),
		'utf8',
	),
};

describe('#1613 overrides aiConfidence honest-null rendering', () => {
	for (const [name, src] of Object.entries(pages)) {
		it(`${name}: aiConfidence is typed number | null`, () => {
			expect(src).toContain('aiConfidence: number | null;');
		});

		it(`${name}: null aiConfidence renders N/A, never 0%`, () => {
			expect(src).toContain("o.aiConfidence == null ? 'N/A'");
			expect(src).not.toContain('<TableCell>{Math.round(o.aiConfidence * 100)}%</TableCell>');
		});
	}

	it('compliance.tsx: Avg AI Confidence averages recorded values only', () => {
		const src = pages['compliance.tsx'];
		expect(src).toContain('overrides.filter((o) => o.aiConfidence != null).length');
		expect(src).not.toContain('sum + o.aiConfidence, 0');
	});
});
