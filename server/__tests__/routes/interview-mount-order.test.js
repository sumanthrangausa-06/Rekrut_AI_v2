/**
 * Full-branch review C1 (#322): router mount-order shadowing.
 *
 * Four routers share the /api/interviews prefix. interviewEventsRoutes'
 * GET /:id carries an isInt(:id) validator that 400s without calling next(),
 * so if it is mounted before interviewSessionRoutes, the new single-segment
 * list GETs (GET /interview-sessions, GET /interview-flows) never reach their
 * router — the unified panel, report, and flow editor can't load on a real
 * server. Per-task tests never caught it because they mount the new router
 * standalone.
 *
 * This test mounts the four routers in the EXACT order server.js uses and
 * asserts the new list GETs reach the new router. If server.js mount order
 * changes, update the order below to match.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	return { ...actual, authMiddleware };
});

// The new router's list handlers only need empty result sets here.
const db = require('../../../lib/db');
db.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

const interviewEventsRoutes = require('../../../routes/interview-events');
const quickPracticeRoutes = require('../../../routes/quick-practice');
const interviewRoutes = require('../../../routes/interviews');
const interviewSessionRoutes = require('../../../routes/interview-sessions');

function buildApp() {
	const app = express();
	app.use(express.json());
	// Derive the mount order from server.js itself (not hardcoded): this test
	// verifies the REAL server wiring, so reordering server.js re-runs the
	// real order instead of a stale copy.
	const serverSrc = require('node:fs').readFileSync(
		require('node:path').join(__dirname, '..', '..', '..', 'server.js'),
		'utf8',
	);
	const order = [...serverSrc.matchAll(/app\.use\('\/api\/interviews',\s*(\w+)\)/g)].map(
		(m) => m[1],
	);
	const routers = {
		interviewEventsRoutes,
		quickPracticeRoutes,
		interviewRoutes,
		interviewSessionRoutes,
	};
	for (const name of order) {
		if (!routers[name]) throw new Error(`mount-order test: unknown router ${name}`);
		app.use('/api/interviews', routers[name]);
	}
	return app;
}

const RECRUITER = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 5 };

beforeEach(() => {
	global.__testUsers = { 2: RECRUITER };
});

describe('C1: /api/interviews mount order', () => {
	test('GET /interview-sessions reaches the unified-session router (not the events :id 400)', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-sessions?candidate_id=1')
			.set('x-test-user-id', '2');

		// The buggy order dies in interview-events' isInt(:id) validator:
		// 400 { error: 'Validation failed' }.
		expect(res.status).not.toBe(400);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.sessions).toEqual([]);
	});

	test('GET /interview-flows reaches the flow router (not the events :id 400)', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-flows?job_id=10')
			.set('x-test-user-id', '2');

		expect(res.status).not.toBe(400);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('legacy single-segment paths still fall through to the old routers', async () => {
		const app = buildApp();
		// No route in the new router matches /123, so it must fall through to
		// interview-events' GET /:id (no rows) -> interviews' GET /:id -> 404.
		const res = await request(app).get('/api/interviews/123').set('x-test-user-id', '2');

		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Interview not found');
	});
});
