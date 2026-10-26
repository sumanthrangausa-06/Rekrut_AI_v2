/**
 * #1575: auth pages, referral landing, and the landing trust bar must not
 * present invented social proof as real adoption (same class as #1278).
 *
 * Source guard over the affected page files. Asserts NONE of them contain:
 *  - "Trusted by 2,000+ companies" (login, register, forgot-password,
 *    reset-password) or the sibling "Join 2,000+ companies" register copy
 *  - "10,000+ professionals" (referral-landing trust indicator)
 *  - the landing named-company trust bar: "Trusted by candidates at top
 *    companies" heading or the companyLogos list (Google, Stripe, Airbnb,
 *    Netflix, Spotify, Shopify, Notion, Figma) — none of these companies
 *    have endorsed Rekrut.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../pages', rel), 'utf8');

const AUTH_PAGES = ['login.tsx', 'register.tsx', 'forgot-password.tsx', 'reset-password.tsx'];

const FABRICATED_COUNT_CLAIMS = ['2,000+ companies', 'Trusted by 2,000+', 'Join 2,000+'];

describe('auth pages invented social proof (#1575)', () => {
	it.each(AUTH_PAGES)('%s contains no invented company-count claim', (file) => {
		const source = read(file);
		for (const claim of FABRICATED_COUNT_CLAIMS) {
			expect(source).not.toContain(claim);
		}
	});

	it('referral-landing contains no invented professional-count claim', () => {
		const source = read('referral-landing.tsx');
		expect(source).not.toContain('10,000+ professionals');
		// factual trust indicators stay
		expect(source).toContain('AI-powered matching');
		expect(source).toContain('Free to join');
	});

	it('landing contains no named-company trust bar', () => {
		const source = read('landing.tsx');
		expect(source).not.toContain('Trusted by candidates at top companies');
		expect(source).not.toContain('companyLogos');
		for (const name of ['Google', 'Stripe', 'Airbnb', 'Netflix', 'Spotify', 'Shopify', 'Notion', 'Figma']) {
			expect(source).not.toContain(`'${name}'`);
		}
		// honest capability statements stay
		expect(source).toContain('AI Job Matching');
	});

	it('auth pages keep the factual SSL badge', () => {
		for (const file of AUTH_PAGES) {
			expect(read(file)).toContain('SSL Secured');
		}
	});
});
