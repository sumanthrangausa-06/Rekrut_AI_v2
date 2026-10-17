/**
 * POST /api/interviews/sessions route tests — S-001 (#640)
 *
 * AC-1: POST with type ai-interview → 201, session with status invited
 * AC-2: Invalid config → 400 with field-level errors, no session created
 * AC-3: Unknown type → 400 INVALID_SESSION_TYPE
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, role: 'recruiter', company_id: 7 };
		next();
	},
}));

const db = require('../../../lib/db');
const sessionsRouter = require('../../../server/routes/interview-sessions-v2');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', sessionsRouter);
	// Error handler to prevent supertest hanging on thrown errors
	app.use((err, req, res, next) => {
		res.status(500).json({ error: 'Test error handler' });
	});
	return app;
}

describe('POST /api/interviews/sessions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('AC-1: creates ai-interview session with status invited', async () => {
		db.query.mockResolvedValue({
			rows: [{ id: 1, type: 'ai_interview', status: 'invited', config: {} }],
		});

		const res = await request(makeApp())
			.post('/api/interviews/sessions')
			.send({ type: 'ai-interview', job_id: 5 });

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.session.status).toBe('invited');
	});

	test('AC-2: invalid config returns 400 with field-level errors', async () => {
		const res = await request(makeApp())
			.post('/api/interviews/sessions')
			.send({ type: 'ai-interview', config: { question_source: 123 } });

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('VALIDATION_ERROR');
		expect(Array.isArray(res.body.errors)).toBe(true);
		expect(res.body.errors[0]).toHaveProperty('field');
		// No session should have been created
		expect(db.query).not.toHaveBeenCalled();
	});

	test('AC-3: unknown type returns 400 INVALID_SESSION_TYPE', async () => {
		const res = await request(makeApp()).post('/api/interviews/sessions').send({ type: 'foo' });

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('INVALID_SESSION_TYPE');
		expect(db.query).not.toHaveBeenCalled();
	});

	test('missing type returns 400', async () => {
		const res = await request(makeApp()).post('/api/interviews/sessions').send({});

		expect(res.status).toBe(400);
		expect(db.query).not.toHaveBeenCalled();
	});

	test('accepts underscore variant ai_interview', async () => {
		db.query.mockResolvedValue({
			rows: [{ id: 2, type: 'ai_interview', status: 'invited', config: {} }],
		});

		const res = await request(makeApp())
			.post('/api/interviews/sessions')
			.send({ type: 'ai_interview' });

		expect(res.status).toBe(201);
	});
});
