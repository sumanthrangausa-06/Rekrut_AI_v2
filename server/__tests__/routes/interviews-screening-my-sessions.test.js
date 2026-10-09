/**
 * Bug fix: GET /screening/my-sessions must read the unified interview_sessions
 * table (type='screening'), not the legacy screening_sessions table.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left this
 * READ endpoint on screening_sessions — invites exist but dashboard shows empty.
 *
 * Desired behavior: my-sessions returns unified-table screenings for the
 * candidate with all fields the frontend consumes (dashboard + ai-screening page).
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

const db = require('../../../lib/db');

const sessions = new Map();
let nextSessionId = 1;

function maybeParse(v) {
	if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}
	return v;
}

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	// Legacy table — should NOT be queried after the fix
	if (normalized.includes('from screening_sessions')) {
		return { rows: [], rowCount: 0 };
	}
	// Unified table query — simulates Postgres JSONB extraction
	if (normalized.includes('from interview_sessions')) {
		const candidateId = Number(params[0]);
		const rows = [...sessions.values()]
			.filter((s) => Number(s.candidate_id) === candidateId && ['screening', 'ai_interview'].includes(s.type))
			.map((s) => ({
				id: s.id,
				status: s.status,
				type: s.type,
				invite_token: s.invite_token,
				application_id: s.application_id,
				job_id: s.job_id,
				started_at: s.started_at,
				completed_at: s.completed_at,
				created_at: s.created_at,
				// Simulated: s.config->'job'->>'title' etc.
				job_title: s.config?.job?.title || null,
				config_company_name: s.config?.job?.company_name || null,
				template_title: s.config?.template?.title || null,
				overall_score: null,
				db_job_title: null,
				db_company_name: null,
			}));
		return { rows, rowCount: rows.length };
	}
	throw new Error(`unexpected SQL in my-sessions test mock: ${sql}`);
});

const interviewsRoutes = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRoutes);
	return app;
}

describe('GET /api/interviews/screening/my-sessions', () => {
	beforeEach(() => {
		sessions.clear();
		nextSessionId = 1;
		global.__testUsers = {
			501: { id: 501, email: 'candidate@test.local', role: 'candidate' },
		};
	});

	test('returns unified-table screenings for the candidate', async () => {
		// Seed a screening in the UNIFIED table (as POST /screening/send does)
		const session = {
			id: nextSessionId++,
			type: 'screening',
			job_id: 100,
			application_id: 200,
			candidate_id: 501,
			company_id: 300,
			triggered_by: 400,
			invite_token: 'tok_abc123',
			status: 'invited',
			config: {
				job: { id: 100, title: 'Data Analyst', company_name: 'Acme Corp' },
				template: { id: 10, title: 'Screening Template' },
			},
			conversation: [],
			started_at: null,
			completed_at: null,
			created_at: new Date().toISOString(),
		};
		sessions.set(session.id, session);

		const app = makeApp();
		const res = await request(app)
			.get('/api/interviews/screening/my-sessions')
			.set('x-test-user-id', '501');

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.sessions).toHaveLength(1);

		const s = res.body.sessions[0];
		expect(s.id).toBe(session.id);
		expect(s.status).toBe('invited');
		expect(s.type).toBe('screening');
		expect(s.job_title).toBe('Data Analyst');
		expect(s.company_name).toBe('Acme Corp');
		expect(s.template_title).toBe('Screening Template');
		expect(s.application_id).toBe(200);
		expect(s.invited_at).toBeDefined();
		expect(s.invite_url).toBe('/interview/session/tok_abc123');
	});

	test('returns empty when candidate has no screenings', async () => {
		const app = makeApp();
		const res = await request(app)
			.get('/api/interviews/screening/my-sessions')
			.set('x-test-user-id', '501');

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(0);
	});

	test('does not return other candidates screenings', async () => {
		sessions.set(1, {
			id: 1,
			type: 'screening',
			candidate_id: 999,
			status: 'invited',
			config: { job: { title: 'Other Job' }, template: { title: 'T' } },
			invite_token: 'tok_other',
			created_at: new Date().toISOString(),
		});

		const app = makeApp();
		const res = await request(app)
			.get('/api/interviews/screening/my-sessions')
			.set('x-test-user-id', '501');

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(0);
	});

	test('returns ai_interview sessions alongside screenings', async () => {
		sessions.set(1, {
			id: 1,
			type: 'screening',
			job_id: 100,
			application_id: 200,
			candidate_id: 501,
			company_id: 300,
			status: 'invited',
			config: { job: { title: 'Data Analyst', company_name: 'Acme' }, template: { title: 'T' } },
			invite_token: 'tok_screen',
			created_at: new Date().toISOString(),
		});
		sessions.set(2, {
			id: 2,
			type: 'ai_interview',
			job_id: 101,
			application_id: 201,
			candidate_id: 501,
			company_id: 300,
			status: 'invited',
			config: { job: { title: 'ML Engineer', company_name: 'Beta' } },
			invite_token: 'tok_ai',
			created_at: new Date().toISOString(),
		});

		const app = makeApp();
		const res = await request(app)
			.get('/api/interviews/screening/my-sessions')
			.set('x-test-user-id', '501');

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(2);

		const ai = res.body.sessions.find((s) => s.id === 2);
		expect(ai).toBeDefined();
		expect(ai.type).toBe('ai_interview');
		expect(ai.job_title).toBe('ML Engineer');
		expect(ai.invite_url).toBe('/interview/session/tok_ai');
	});

	test('requires authentication', async () => {
		const app = makeApp();
		const res = await request(app).get('/api/interviews/screening/my-sessions');
		expect(res.status).toBe(401);
	});
});
