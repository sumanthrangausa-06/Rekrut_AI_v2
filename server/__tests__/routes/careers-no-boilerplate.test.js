/**
 * #1557: Careers success payload must not return boilerplate as fact.
 *
 * routes/careers.js returned the same hard-coded culture.benefits
 * (8 items: "100% coverage…", "$5,000/year learning budget", "20 weeks
 * paid parental leave", …), the same hard-coded culture.values, and
 * placeholder team entries ("Team Lead" / "Hiring Manager") for EVERY
 * company, in both handlers (/default and /:id).
 *
 * Real sources (migration 003): companies.benefits and
 * companies.core_values are JSONB string arrays written via
 * PUT /company/profile. Wire those. No career-team source exists in
 * the schema, so team is [] — never invented people/quotes.
 * The client (career-page.tsx) maps over all three arrays
 * unconditionally, so empty arrays — not null/omission — are required.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'recruiter', company_id: 42 };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const pool = require('../../../lib/db');
const careersRouter = require('../../../routes/careers');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/careers', careersRouter);
	return app;
}

const companyRow = (overrides = {}) => ({
	id: 42,
	name: 'Acme Inc',
	slug: 'acme',
	industry: 'Technology',
	size: null,
	website: 'https://acme.example.com',
	description: 'Acme builds things.',
	logo_url: null,
	location: 'Remote',
	founded_year: 2020,
	open_positions: 0,
	rating: null,
	review_count: 0,
	trustscore: null,
	benefits: [],
	core_values: [],
	...overrides,
});

function mockDb(company = {}) {
	pool.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM companies')) return { rows: [companyRow(company)] };
		if (sql.includes('job_applications')) return { rows: [{ avg_days: null }] };
		if (sql.includes('FROM jobs')) return { rows: [] };
		return { rows: [] };
	});
}

const BOILERPLATE = [
	'100% coverage for you and dependents',
	'$5,000/year for courses and conferences',
	'20 weeks paid for all parents',
	'Unlimited PTO',
	'Team Lead',
	'Hiring Manager',
	'We build the future together',
	'People are our greatest asset',
];

const PATHS = ['/api/careers/default', '/api/careers/acme'];

describe('careers no-boilerplate payload (#1557)', () => {
	beforeEach(() => jest.clearAllMocks());

	for (const path of PATHS) {
		it(`${path}: company with no stored benefits/values gets empty arrays, no boilerplate anywhere`, async () => {
			mockDb();
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			expect(res.body.culture.benefits).toEqual([]);
			expect(res.body.culture.values).toEqual([]);
			expect(res.body.team).toEqual([]);
			const payload = JSON.stringify(res.body);
			for (const s of BOILERPLATE) expect(payload).not.toContain(s);
		});

		it(`${path}: company with stored benefits/values receives its own, normalised to the client shape`, async () => {
			mockDb({ benefits: ['Dental cover', 'Cycle to work'], core_values: ['Candour', 'Craft'] });
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			expect(res.body.culture.values).toEqual(['Candour', 'Craft']);
			expect(res.body.culture.benefits).toEqual([
				{ icon: 'default', label: 'Dental cover', description: '' },
				{ icon: 'default', label: 'Cycle to work', description: '' },
			]);
			expect(res.body.team).toEqual([]);
		});
	}

	it('two different companies do NOT receive identical benefits/team', async () => {
		mockDb({ benefits: ['Dental cover'], core_values: ['Candour'] });
		const a = await request(buildApp()).get('/api/careers/acme');
		mockDb({ benefits: ['Gym stipend'], core_values: ['Speed'] });
		const b = await request(buildApp()).get('/api/careers/acme');
		expect(a.body.culture.benefits).not.toEqual(b.body.culture.benefits);
		expect(a.body.culture.values).not.toEqual(b.body.culture.values);
		expect(a.body.team).toEqual([]);
		expect(b.body.team).toEqual([]);
	});

	it('benefits/values are selected from the companies row (real source wired)', async () => {
		mockDb();
		await request(buildApp()).get('/api/careers/acme');
		const companyQueries = pool.query.mock.calls
			.map(([sql]) => sql)
			.filter((sql) => sql.includes('FROM companies'));
		expect(companyQueries.length).toBeGreaterThan(0);
		for (const sql of companyQueries) {
			expect(sql).toContain('benefits');
			expect(sql).toContain('core_values');
		}
	});
});
