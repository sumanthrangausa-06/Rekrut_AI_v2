/**
 * #1311: the About page must not present invented platform numbers or
 * unsourced statistics as real data (Sumanth ruling on #1278, comment
 * 6235774647: REMOVE invented numbers; real counts wired later as a
 * separate story when real counts exist).
 *
 * Source guard over client/src/pages/about.tsx, in the
 * LandingHonestClaims pattern. Asserts the file contains NONE of the
 * fabricated strings verified at dev 65f725fc:
 *  - the stat-card grid: "50K+" Candidates matched, "40%" Faster
 *    time-to-hire, "3x" Better candidate matches, "15+" Countries
 *    supported
 *  - the prose product claim "hire 40% faster"
 *  - unsourced industry statistics presented as fact: "42 days" to
 *    fill a role, "100+" applications, "fewer than 10" hear back
 * The rendered "3x" is matched with a regex because the bare substring
 * also appears inside Tailwind classes such as "text-3xl".
 */
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../../pages/about.tsx'), 'utf8');

const FABRICATED = [
	'50K+',
	'>Candidates matched</p>', // the stat label paired with "50K+" (exact form; honest prose may say "candidates matched to roles")
	'40%',
	'Faster time-to-hire',
	'Better candidate matches',
	'15+',
	'Countries supported',
	'42 days',
	'100+',
	'fewer than 10',
];

describe('about page honest claims (#1311)', () => {
	it.each(FABRICATED)('does not contain fabricated claim: %s', (claim) => {
		expect(source).not.toContain(claim);
	});

	it('does not contain the rendered "3x" stat', () => {
		expect(source).not.toMatch(/>\s*3x\s*</);
		expect(source).not.toMatch(/\n\s*3x\s*\n/);
	});

	it('keeps honest capability statements (what the product does)', () => {
		expect(source).toContain('AI Matching');
		expect(source).toContain('Two-Sided Scoring');
	});
});
