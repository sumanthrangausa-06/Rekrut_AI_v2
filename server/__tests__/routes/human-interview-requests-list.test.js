/**
 * S-061 (#711): GET /api/interviews/human-requests — list pending requests.
 *
 * Route tests: the service owns business logic; routes map auth + errors.
 *   AC-1: hiring role → 200 with { requests: [...] }
 *   AC-5: candidate role → 403
 *   AC-4: service returns [] → 200 with empty array
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = global.__TEST_USER__ || { id: 7, role: 'recruiter', company_id: 3 };
		next();
	},
}));
jest.mock('../../../lib/consentService', () => ({
	assertSessionOwnership: jest.fn(),
	getConsentStatus: jest.fn(),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn(),
}));
jest.mock('../../../lib/sessionService', () => ({
	create: jest.fn(),
	HIRING_ROLES: ['recruiter', 'hiring_manager', 'employer', 'admin'],
}));

const db = require('../../../lib/db');
const humanRouter = require('../../../server/routes/human-interview-requests');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', humanRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => {
		res.status(err.status || 500).json({ code: err.code || 'INTERNAL_ERROR' });
	});
	return app;
}

const PENDING_ROWS = [
	{
		id: 1,
		session_id: 10,
		candidate_id: 42,
		status: 'pending',
		created_at: '2026-10-10T10:00:00.000Z',
		candidate_name: 'Jane Candidate',
		job_title: 'Backend Engineer',
		session_type: 'ai_interview',
	},
];

describe('GET /api/interviews/human-requests', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		global.__TEST_USER__ = { id: 7, role: 'recruiter', company_id: 3 };
	});

	test('AC-1: hiring role → 200 with pending requests', async () => {
		db.query.mockResolvedValueOnce({ rows: PENDING_ROWS });

		const res = await request(makeApp()).get('/api/interviews/human-requests');

		expect(res.status).toBe(200);
		expect(res.body.requests).toHaveLength(1);
		expect(res.body.requests[0]).toMatchObject({
			candidate_name: 'Jane Candidate',
			job_title: 'Backend Engineer',
		});
	});

	test('AC-4: no pending requests → 200 with empty array', async () => {
		db.query.mockResolvedValueOnce({ rows: [] });

		const res = await request(makeApp()).get('/api/interviews/human-requests');

		expect(res.status).toBe(200);
		expect(res.body.requests).toEqual([]);
	});

	test('AC-5: candidate role → 403', async () => {
		global.__TEST_USER__ = { id: 42, role: 'candidate', company_id: null };

		const res = await request(makeApp()).get('/api/interviews/human-requests');

		expect(res.status).toBe(403);
		expect(db.query).not.toHaveBeenCalled();
	});
});
