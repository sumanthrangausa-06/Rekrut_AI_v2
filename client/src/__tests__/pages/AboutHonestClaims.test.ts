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

/**
 * #1314 (follow-up from the #1311 / PR #1313 independent review): the
 * About timeline + founder bio must not assert unverified history.
 * Scout verification (issue #1314, STOP 1 comment):
 *  - "HireLoop" VERIFIED AND KEPT (correction to the original STOP 1
 *    evidence): the former name is corroborated across the repo —
 *    landing.tsx footer "Rekrut AI (formerly HireLoop)", the admin
 *    login "HireLoop Administration Panel", and ai-health "HireLoop
 *    Monitoring & Control". It is a consistent former product name in
 *    the record, not an About-only invention, so it stays.
 *  - "Global expansion with multi-region support": zero multi-region
 *    evidence in code or docs; render.yaml is a single web service;
 *    recorded posture is pre-launch (end-Nov 2026), USA + India, EU
 *    postponed — same fabricated class as "15+ Countries supported".
 *  - "deployed" / "launched" past-tense launch claims for the matching
 *    engine and OmniScore/Trust Score: the features are real in code
 *    but not publicly launched pre-launch; honest tense is "built".
 *  - Founder bio "Previously led talent acquisition at two high-growth
 *    startups": unverifiable from the record — removed, not replaced.
 *  - "TrustScore" one-word: canonical spelling is "Trust Score"
 *    (already used on this page for the company score card).
 */
const UNVERIFIED_1314 = [
	'Global expansion with multi-region support',
	'multi-region',
	'TrustScore',
	'Previously led talent acquisition',
	'two high-growth startups',
	'First AI matching engine deployed',
	'OmniScore & TrustScore launched',
	// Reviewer Low (PR #1319): guard the bare past-tense launch words too,
	// so the tense fix cannot silently regress while the product is
	// pre-launch. The page currently contains neither word anywhere.
	'deployed',
	'launched',
];

describe('about page verified history (#1314)', () => {
	it.each(UNVERIFIED_1314)('does not contain unverified claim: %s', (claim) => {
		expect(source).not.toContain(claim);
	});

	it('keeps the verified timeline and canonical spelling', () => {
		expect(source).toContain('Rekrut AI founded in India as HireLoop');
		// Reviewer Low (PR #1319): "(formerly HireLoop)" appears twice
		// (SEO description + hero) — assert the count, not just presence,
		// so deleting one occurrence is caught.
		expect(source.split('(formerly HireLoop)').length - 1).toBe(2);
		expect(source).toContain('First AI matching engine built');
		expect(source).toContain('OmniScore & Trust Score built');
		expect(source).toContain('Trust Score');
	});

	it('keeps the verifiable founder motivation sentence', () => {
		expect(source).toContain('Ranga built Rekrut AI after watching recruiters drown in spreadsheets');
	});
});

/**
 * #1917 S-D15 AC-5 (Sumanth ruling, 2026-10-28): the Desert Ant Labs
 * attribution for speaker labelling goes on the existing About page as
 * one line — "Speaker labelling powered by Desert Ant Labs." — with NO
 * new page. The repo README credit already landed in PR #1948; this
 * source guard pins the page half.
 */
describe('about page speaker-labelling attribution (#1917 AC-5)', () => {
	it('contains the exact Desert Ant Labs credit line', () => {
		expect(source).toContain('Speaker labelling powered by Desert Ant Labs.');
	});

	it('contains the credit line exactly once', () => {
		expect(source.split('Speaker labelling powered by Desert Ant Labs.').length - 1).toBe(1);
	});
});
