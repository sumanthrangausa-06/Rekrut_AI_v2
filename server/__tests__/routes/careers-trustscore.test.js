/**
 * S-111 (#836): Fabricated score fallbacks on the public careers surface.
 *
 * routes/careers.js presented `company.trustscore` as the average of
 * candidate OmniScores for users at the company, fabricated to 75 when
 * empty (`Math.round(company.trustscore || 75)`). The fix: the public
 * surface shows the company's real Trust Score — the stored output of
 * the live engine (services/trustscore.js → trust_scores.total_score) —
 * or no number at all (null) until that basis exists.
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

const companyRow = (trustscore) => ({
	id: 42,
	name: 'Acme Inc',
	slug: 'acme',
	industry: 'Technology',
	size: '11-50 employees',
	website: 'https://acme.example.com',
	description: 'Acme builds things.',
	logo_url: null,
	location: 'Remote',
	founded_year: 2020,
	open_positions: 2,
	employee_count: 12,
	rating: 0,
	review_count: 0,
	trustscore,
});

function mockDb(trustscore) {
	pool.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM companies')) return { rows: [companyRow(trustscore)] };
		if (sql.includes('FROM jobs')) return { rows: [] };
		return { rows: [] };
	});
}

describe('careers trustscore (S-111)', () => {
	beforeEach(() => jest.clearAllMocks());

	it('public page: company with NO Trust Score basis renders no numeric score (never 75)', async () => {
		mockDb(null);
		const res = await request(buildApp()).get('/api/careers/acme');
		expect(res.status).toBe(200);
		expect(res.body.company.trustscore).toBeNull();
	});

	it('public page: company WITH a real Trust Score basis renders that score', async () => {
		mockDb(822.4);
		const res = await request(buildApp()).get('/api/careers/acme');
		expect(res.status).toBe(200);
		expect(res.body.company.trustscore).toBe(822);
	});

	it('default page: no basis → null, not 75', async () => {
		mockDb(null);
		const res = await request(buildApp()).get('/api/careers/default');
		expect(res.status).toBe(200);
		expect(res.body.company.trustscore).toBeNull();
	});

	it('the score is read from trust_scores (engine output), never averaged from candidate omni_scores', async () => {
		mockDb(null);
		await request(buildApp()).get('/api/careers/acme');
		const companyQueries = pool.query.mock.calls
			.map(([sql]) => sql)
			.filter((sql) => sql.includes('FROM companies'));
		expect(companyQueries.length).toBeGreaterThan(0);
		for (const sql of companyQueries) {
			expect(sql).toContain('trust_scores');
			expect(sql).not.toContain('omni_scores');
		}
	});
});
