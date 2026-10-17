/**
 * #1278 (Site 1): Careers `founded` honest null.
 *
 * routes/careers.js served `founded: company.founded_year ?
 * String(company.founded_year) : '2020'` in BOTH handlers
 * (/default and /:id — the latter is public, no auth). founded_year is
 * nullable with no default (migrations/002), and company creation/forms
 * accept blank, so any company without a founding year was served a
 * fabricated '2020' on a public endpoint.
 *
 * Fix follows the same-file #1188 honest-null precedent (size /
 * trustscore / rating / employees / growthRate): no year on record →
 * founded is null, never an invented year. A real year is served
 * exactly as before (string form).
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
	founded_year: null,
	open_positions: 0,
	employee_count: 3,
	rating: null,
	review_count: 0,
	trustscore: null,
	...overrides,
});

function mockDb({ company = {} } = {}) {
	pool.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM companies')) return { rows: [companyRow(company)] };
		if (sql.includes('job_applications')) return { rows: [{ avg_days: null }] };
		if (sql.includes('FROM jobs')) return { rows: [] };
		return { rows: [] };
	});
}

const PATHS = ['/api/careers/default', '/api/careers/acme'];

describe('careers founded honest null (#1278)', () => {
	beforeEach(() => jest.clearAllMocks());

	for (const path of PATHS) {
		it(`${path}: NULL founded_year → founded is null, never the fabricated '2020'`, async () => {
			mockDb({ company: { founded_year: null } });
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			expect(res.body.company.founded).toBeNull();
			expect(JSON.stringify(res.body)).not.toContain('"founded":"2020"');
		});

		it(`${path}: real founded_year → served as its string form (regression)`, async () => {
			mockDb({ company: { founded_year: 2015 } });
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			expect(res.body.company.founded).toBe('2015');
		});
	}
});
