/**
 * #2057: mutual-matches must carry the job's numeric salary fields.
 *
 * The omniscore Mutual Matches surface rendered only salary_range text;
 * min/max-only jobs showed no salary. The fix routes the client through
 * the shared formatter (client/src/lib/salary.ts), which needs
 * salary_min / salary_max / currency_code in the payload — so the
 * route's SELECT (and GROUP BY) was widened. This test pins both: the
 * SQL asks for the columns, and a row's fields pass through to the
 * response unchanged (PG NUMERIC arrives as a string; the client
 * formatter coerces).
 *
 * Mock pattern mirrors omniscore-mutual-matches-1271.test.js.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

jest.mock('../../../services/omniscore', () => ({
	getOrCreateScore: jest.fn(async () => ({})),
	calculateScore: jest.fn(async () => ({ total_score: 630, tier_label: 'Good' })),
	SCORE_RANGES: {},
}));

jest.mock('../../../services/trustscore', () => ({
	getOrCreateTrustScore: jest.fn(async () => ({})),
	calculateTrustScore: jest.fn(async () => ({})),
	TRUST_SCORE_RANGES: { TIERS: {} },
	generateTrustRecommendations: jest.fn(() => []),
	addFeedbackComponent: jest.fn(async () => {}),
}));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
}));

const pool = require('../../../lib/db');
const omniscoreRouter = require('../../../routes/omniscore');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/omniscore', omniscoreRouter);
	return app;
}

const matchRow = (overrides = {}) => ({
	job_id: 2057,
	title: 'Analyst',
	location: 'Remote',
	salary_range: null,
	salary_min: '80000.00',
	salary_max: '120000.00',
	currency_code: 'USD',
	job_type: 'full-time',
	company_id: 9,
	company_name: 'Acme',
	logo_url: null,
	industry: null,
	is_verified: true,
	company_trust_score: 800,
	company_tier: 'gold',
	application_status: 'applied',
	match_score: 90,
	match_level: 'excellent',
	avg_company_rating: 0,
	rating_count: 0,
	...overrides,
});

describe('#2057 mutual-matches salary fields', () => {
	beforeEach(() => jest.clearAllMocks());

	it('SELECT asks for salary_min/salary_max/currency_code and the response carries them', async () => {
		let capturedSql = '';
		pool.query.mockImplementation(async (sql) => {
			capturedSql = sql;
			return { rows: [matchRow()] };
		});

		const res = await request(buildApp()).get('/api/omniscore/mutual-matches');

		expect(res.status).toBe(200);
		expect(capturedSql).toContain('j.salary_min');
		expect(capturedSql).toContain('j.salary_max');
		expect(capturedSql).toContain('j.currency_code');
		const match = res.body.mutual_matches[0];
		expect(match.salary_min).toBe('80000.00');
		expect(match.salary_max).toBe('120000.00');
		expect(match.currency_code).toBe('USD');
	});

	it('no-salary job passes honest nulls through (no invented figure)', async () => {
		pool.query.mockImplementation(async () => ({
			rows: [matchRow({ salary_min: null, salary_max: null })],
		}));

		const res = await request(buildApp()).get('/api/omniscore/mutual-matches');

		expect(res.status).toBe(200);
		const match = res.body.mutual_matches[0];
		expect(match.salary_min).toBeNull();
		expect(match.salary_max).toBeNull();
	});
});
