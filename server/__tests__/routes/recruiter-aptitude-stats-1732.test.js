/**
 * #1732 — GET /recruiter/aptitude-tests/stats returned 500 "Failed to fetch
 * test" because the route was registered AFTER GET
 * /recruiter/aptitude-tests/:id in routes/aptitude.js: Express matched the
 * literal segment "stats" as :id, parseInt('stats') was NaN and the :id
 * handler failed.
 *
 * Fix: register /stats before /:id.
 *
 * Mock note: only module boundaries are stubbed (db, auth, notify, audit).
 * The fake DB keys its answers on the SQL each handler actually sends, so
 * the suite proves ROUTING (which handler ran), not just payload shape.
 * Express routing and both handlers run for real. The Quinn HL-003 gate
 * (real PG, real HTTP) provides the fresh-install proof.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, _res, next) => {
		req.user = { id: 7, role: 'recruiter', company_id: 3 };
		return next();
	},
}));

const mockQuery = jest.fn(async (sql, params) => {
	const q = String(sql);
	// Stats handler — overall stats query
	if (/total_attempts/.test(q) && /FROM aptitude_test_attempts/.test(q)) {
		return {
			rows: [
				{
					total_attempts: '4',
					completed_count: '3',
					timed_out_count: '1',
					avg_score: '7.5',
					avg_max_score: '10.0',
					avg_percentile: '60.0',
					highest_score: 9,
					lowest_score: 5,
					avg_anti_cheat_score: '98.0',
					avg_time_spent: '300',
				},
			],
		};
	}
	// Stats handler — distribution query
	if (/as bucket/.test(q)) return { rows: [{ bucket: '70-79%', count: '2' }] };
	// Stats handler — category query
	if (/q\.category/.test(q)) return { rows: [{ category: 'logic', total_answers: '4', correct_answers: '3', accuracy_pct: '75.0' }] };
	// :id handler — single test lookup
	if (/SELECT \* FROM aptitude_tests WHERE id = \$1/.test(q)) {
		if (params && params[0] === 5) return { rows: [{ id: 5, title: 'Logic Basics' }] };
		return { rows: [] };
	}
	// :id handler — its questions
	if (/FROM aptitude_questions WHERE test_id/.test(q)) return { rows: [{ id: 51, test_id: 5 }] };
	return { rows: [] };
});
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	connect: async () => ({ query: (...args) => mockQuery(...args), release: jest.fn() }),
}));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn(async () => {}) }));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn(async () => {}) })),
}));

const aptitudeRouter = require('../../../routes/aptitude');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api', aptitudeRouter);
	return app;
}

beforeAll(() => {
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
beforeEach(() => jest.clearAllMocks());

describe('#1732 recruiter aptitude stats routing', () => {
	test('GET /recruiter/aptitude-tests/stats reaches the stats handler (200 + stats payload), not /:id', async () => {
		const res = await request(buildApp()).get('/api/recruiter/aptitude-tests/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats).toBeDefined();
		expect(Number(res.body.stats.total_attempts)).toBe(4);
		expect(res.body.scoreDistribution).toEqual([{ bucket: '70-79%', count: '2' }]);
		expect(res.body.categoryBreakdown).toHaveLength(1);
	});

	test('GET /recruiter/aptitude-tests/stats?testId=5 forwards the test filter and still routes to stats', async () => {
		const res = await request(buildApp()).get('/api/recruiter/aptitude-tests/stats?testId=5');
		expect(res.status).toBe(200);
		expect(res.body.stats).toBeDefined();
		const statsCall = mockQuery.mock.calls.find(([sql]) => /total_attempts/.test(String(sql)));
		expect(statsCall[1]).toEqual([5]);
	});

	test('GET /recruiter/aptitude-tests/:id still serves a real test with its questions', async () => {
		const res = await request(buildApp()).get('/api/recruiter/aptitude-tests/5');
		expect(res.status).toBe(200);
		expect(res.body.test).toEqual({ id: 5, title: 'Logic Basics' });
		expect(res.body.questions).toHaveLength(1);
	});

	test('GET /recruiter/aptitude-tests/:id with an unknown id still 404s', async () => {
		const res = await request(buildApp()).get('/api/recruiter/aptitude-tests/999');
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Test not found');
	});
});
