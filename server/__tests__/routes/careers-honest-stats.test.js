/**
 * #1188: Careers page honest stats (Wave 2 honesty fixes).
 *
 * routes/careers.js hard-coded the company stats in BOTH handlers
 * (/default and /:id): avgTimeToHire 18, growthRate 34,
 * employees `parseInt(employee_count) || 50`, rating fallback '4.5'.
 * Lead's STOP 1 ruling on #1188:
 *  - avgTimeToHire — real AVG(hired_at - applied_at) in days over
 *    job_applications WHERE status='hired' (pattern: routes/recruiter.js);
 *    no hires → null.
 *  - rating — real AVG(overall_rating) from published company_ratings
 *    when review_count > 0, else null. The '4.5' fallback dies.
 *  - growthRate — null. No real source exists.
 *  - employees — NOT the platform team-account count; the stat carries
 *    the company's declared company_size (selected as `size`) as a
 *    string, or null when undeclared.
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
	employee_count: 3,
	rating: null,
	review_count: 0,
	trustscore: null,
	...overrides,
});

function mockDb({ company = {}, avgDays = null } = {}) {
	pool.query.mockImplementation(async (sql) => {
		if (sql.includes('FROM companies')) return { rows: [companyRow(company)] };
		if (sql.includes('job_applications')) return { rows: [{ avg_days: avgDays }] };
		if (sql.includes('FROM jobs')) return { rows: [] };
		return { rows: [] };
	});
}

const PATHS = ['/api/careers/default', '/api/careers/acme'];

describe('careers honest stats (#1188)', () => {
	beforeEach(() => jest.clearAllMocks());

	for (const path of PATHS) {
		it(`${path}: no-data company → all four stats honest null, no invented 18/34/50/'4.5' anywhere`, async () => {
			mockDb();
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			expect(res.body.stats.avgTimeToHire).toBeNull();
			expect(res.body.stats.growthRate).toBeNull();
			expect(res.body.stats.employees).toBeNull();
			expect(res.body.company.rating).toBeNull();
			expect(res.body.company.reviewCount).toBe(0);
			// No declared size → null, never the invented '11-50 employees'.
			expect(res.body.company.size).toBeNull();
			const payload = JSON.stringify(res.body);
			expect(payload).not.toContain('11-50 employees');
			expect(payload).not.toContain('"avgTimeToHire":18');
			expect(payload).not.toContain('"growthRate":34');
			expect(payload).not.toContain('"employees":50');
			expect(payload).not.toContain('4.5');
		});

		it(`${path}: published ratings + a hire → computed rating and computed time-to-hire`, async () => {
			mockDb({
				company: { size: '51-200', rating: '4.666666666666667', review_count: 3 },
				avgDays: '20.5',
			});
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(200);
			// Real AVG(overall_rating), normalised to a number.
			expect(res.body.company.rating).toBe(4.7);
			expect(res.body.company.reviewCount).toBe(3);
			// Real AVG(hired_at - applied_at) in days.
			expect(res.body.stats.avgTimeToHire).toBe(20.5);
			// Declared company_size as a string — not the team-account count (3).
			expect(res.body.stats.employees).toBe('51-200');
			expect(res.body.company.size).toBe('51-200');
			// Still no source → still null, even for a company with data.
			expect(res.body.stats.growthRate).toBeNull();
		});
	}

	it('time-to-hire is computed from hired applications only', async () => {
		mockDb({ avgDays: '9.25' });
		await request(buildApp()).get('/api/careers/acme');
		const tthQueries = pool.query.mock.calls
			.map(([sql]) => sql)
			.filter((sql) => sql.includes('job_applications'));
		expect(tthQueries.length).toBeGreaterThan(0);
		for (const sql of tthQueries) {
			expect(sql).toContain("status = 'hired'");
			expect(sql).toContain('hired_at');
			expect(sql).toContain('applied_at');
		}
	});
});
