/**
 * Session lifecycle route tests — S-003 (#642)
 *
 * PATCH /sessions/:id/state   → 409 SESSION_STATE_CONFLICT on invalid transition
 * POST  /sessions/:id/heartbeat
 * GET   /sessions/:id/state   → lazy pause evaluation (AC-1)
 * POST  /sessions/:id/resume  → 403 on wrong token (AC-2)
 *
 * All routes require per-session authorization (specialist finding #3).
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null };
		next();
	},
}));

const db = require('../../../lib/db');
const lifecycleRouter = require('../../../server/routes/session-lifecycle');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', lifecycleRouter);
	app.use((err, req, res, next) => {
		res.status(500).json({ error: 'Test error handler' });
	});
	return app;
}

// Session owned by req.user (id 42)
const ownedSession = { id: 1, candidate_id: 42, triggered_by: 7, company_id: 5 };

describe('session lifecycle routes', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('PATCH /sessions/:id/state', () => {
		test('valid transition → 200 with session', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [ownedSession] }) // _loadOwned
				.mockResolvedValueOnce({ rows: [{ ...ownedSession, status: 'paused' }] }); // transition

			const res = await request(makeApp())
				.patch('/api/interviews/sessions/1/state')
				.send({ to_state: 'paused' });

			expect(res.status).toBe(200);
			expect(res.body.session.status).toBe('paused');
		});

		test('AC-3: invalid transition → 409 SESSION_STATE_CONFLICT', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [ownedSession] }) // _loadOwned
				.mockResolvedValueOnce({ rows: [] }) // UPDATE: 0 rows
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'completed' }] }); // reporting read

			const res = await request(makeApp())
				.patch('/api/interviews/sessions/1/state')
				.send({ to_state: 'in_progress' });

			expect(res.status).toBe(409);
			expect(res.body.code).toBe('SESSION_STATE_CONFLICT');
		});

		test('unauthorized user → 403 FORBIDDEN', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, candidate_id: 99, triggered_by: 99, company_id: 5 }],
			}); // _loadOwned: not owner

			const res = await request(makeApp())
				.patch('/api/interviews/sessions/1/state')
				.send({ to_state: 'paused' });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('FORBIDDEN');
		});

		test('missing to_state → 400', async () => {
			db.query.mockResolvedValueOnce({ rows: [ownedSession] });

			const res = await request(makeApp())
				.patch('/api/interviews/sessions/1/state')
				.send({});

			expect(res.status).toBe(400);
		});
	});

	describe('POST /sessions/:id/heartbeat', () => {
		test('in_progress heartbeat → 200', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [ownedSession] })
				.mockResolvedValueOnce({ rows: [{ ...ownedSession, status: 'in_progress' }] });

			const res = await request(makeApp()).post('/api/interviews/sessions/1/heartbeat');

			expect(res.status).toBe(200);
		});
	});

	describe('GET /sessions/:id/state', () => {
		test('returns session state', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [ownedSession] }) // _loadOwned
				.mockResolvedValueOnce({ rows: [] }) // lazy-pause UPDATE: nothing stale
				.mockResolvedValueOnce({ rows: [{ ...ownedSession, status: 'in_progress' }] }); // SELECT

			const res = await request(makeApp()).get('/api/interviews/sessions/1/state');

			expect(res.status).toBe(200);
			expect(res.body.session.status).toBe('in_progress');
		});
	});

	describe('POST /sessions/:id/resume', () => {
		test('AC-2: valid token → 200 with question index', async () => {
			db.query
				.mockResolvedValueOnce({
					rows: [{ id: 1, status: 'paused', invite_token: 'tok123' }],
				}) // token check
				.mockResolvedValueOnce({
					rows: [{ id: 1, status: 'in_progress', current_question_index: 5 }],
				}); // guarded UPDATE

			const res = await request(makeApp())
				.post('/api/interviews/sessions/1/resume')
				.send({ invite_token: 'tok123' });

			expect(res.status).toBe(200);
			expect(res.body.session.current_question_index).toBe(5);
		});

		test('wrong token → 403 INVALID_TOKEN', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ id: 1, status: 'paused', invite_token: 'tok123' }],
			});

			const res = await request(makeApp())
				.post('/api/interviews/sessions/1/resume')
				.send({ invite_token: 'wrong' });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('INVALID_TOKEN');
		});
	});
});
