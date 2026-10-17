/**
 * #1278 Site 2: landing page must not present invented platform numbers
 * or unsourced testimonials as real data (Sumanth ruling, Option 1:
 * REMOVE the invented numbers; honest capability statements instead).
 *
 * Source guard over client/src/pages/landing.tsx. Asserts the file
 * contains NONE of the fabricated strings Scout verified at dev
 * 34793cea (comment 6234998516):
 *  - "50,000+" / "50K+" / 50000 candidate counts (hero, trust bar,
 *    dashboard preview, Live Stats targets, CTA banner)
 *  - "2,400+" / 2400 open positions and "87%" avg. match score
 *    (dashboard preview + "Live Stats" count-up targets)
 *  - "94%" interview success rate and "3x" better job matches (hero stats)
 *  - the "Live Stats" badge itself (hard-coded count-up is not live data)
 *  - unsourced testimonials: "Success stories from real candidates"
 *    heading and the four invented authors (Sarah K. / Marcus T. /
 *    Priya R. / James L.)
 *  - "We analyzed 10,000 practice interviews" blog claim
 *  - the dashboard-preview example jobs naming Stripe / Netflix /
 *    Airbnb with invented match scores
 */
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../../pages/landing.tsx'), 'utf8');

const FABRICATED = [
	'50,000+',
	'50K+',
	'50000',
	'2,400+',
	'2400',
	'87%',
	'94%',
	'Better job matches',
	'Interview success rate',
	'Live Stats',
	'Success stories from real candidates',
	'Sarah K.',
	'Marcus T.',
	'Priya R.',
	'James L.',
	'10,000 practice interviews',
	'Senior React Developer at Stripe',
	'Product Manager at Netflix',
	'UX Designer at Airbnb',
];

describe('landing page honest claims (#1278 Site 2)', () => {
	it.each(FABRICATED)('does not contain fabricated claim: %s', (claim) => {
		expect(source).not.toContain(claim);
	});

	it('keeps honest capability statements (what the product does)', () => {
		expect(source).toContain('AI Job Matching');
		expect(source).toContain('Mock Interviews');
	});
});
