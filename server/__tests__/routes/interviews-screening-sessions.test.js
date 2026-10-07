/**
 * Bug fix: GET /screening/sessions must read the unified interview_sessions
 * table (type='screening'), not the legacy screening_sessions table.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left
 * this recruiter READ endpoint on screening_sessions — sent invites are
 * invisible on the recruiter's screening monitor page.
 *
 * Desired behavior: /screening/sessions returns unified-table screenings for
 * the recruiter's company with all fields the screening-monitor page consumes.
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

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	// Legacy table — should NOT be queried after the fix
	if (normalized.includes('from screening_sessions')) {
		return { rows: [], rowCount: 0 };
	}
	// Unified table query
	if (normalized.includes('from interview_sessions')) {
		const companyId = Number(params[0]);
		// Optional status filter is params[1] when present (job_id filter would be params[1] too — check SQL)
		const hasStatusFilter = normalized.includes('and s.status = $');
		const statusFilter = hasStatusFilter ? params[params.length - 1] : null;
		const rows = [...sessions.values()]
			.filter((s) => Number(s.company_id) === companyId && s.type === 'screening')
			.filter((s) => !statusFilter || s.status === statusFilter)
			.map((s) => ({
				id: s.id,
				status: s.status,
				invite_token: s.invite_token,
				application_id: s.application_id,
				job_id: s.job_id,
				candidate_id: s.candidate_id,
				candidate_name: 'Test Candidate',
				candidate_email: 'candidate@test.com',
				started_at: s.started_at,
				completed_at: s.completed_at,
				created_at: s.created_at,
				invited_at: s.created_at,
				conversation: s.conversation || [],
				// Simulated: s.config->'job'->>'title' as config_job_title etc.
				config_job_title: s.config?.job?.title || null,
				config_template_title: s.config?.template?.title || null,
				db_job_title: null,
				db_template_title: null,
				screening_mode: s.config?.template?.mode || null,
				current_phase: s.config?.current_phase || null,
				overall_score: null,
				recommendation: null,
			}));
		return { rows, rowCount: rows.length };
	}
	throw new Error(`unexpected SQL in screening-sessions test mock: ${sql}`);
});

const interviewsRoutes = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRoutes);
	return app;
}

beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	global.__testUsers = {
		1: { id: 1, company_id: 10, role: 'recruiter', email: 'rec@test.com' },
		2: { id: 2, company_id: 99, role: 'recruiter', email: 'other@test.com' },
	};
});

function addUnifiedSession(overrides = {}) {
	const id = nextSessionId++;
	const session = {
		id,
		type: 'screening',
		status: 'invited',
		invite_token: `token-${id}`,
		application_id: 100 + id,
		job_id: 200,
		candidate_id: 300,
		company_id: 10,
		started_at: null,
		completed_at: null,
		created_at: new Date().toISOString(),
		conversation: [],
		config: {
			current_phase: 'intro',
			job: { id: 200, title: 'Data Analyst', company_name: 'TestCo' },
			template: { id: 5, title: 'Screening Template', mode: 'voice' },
		},
		...overrides,
	};
	sessions.set(id, session);
	return session;
}

describe('GET /api/interviews/screening/sessions', () => {
	test('returns unified-table screenings for the recruiter company', async () => {
		addUnifiedSession();
		addUnifiedSession({ status: 'completed' });

		const res = await request(makeApp())
			.get('/api/interviews/screening/sessions')
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.sessions).toHaveLength(2);
		expect(res.body.sessions[0].candidate_name).toBe('Test Candidate');
		expect(res.body.sessions[0].job_title).toBe('Data Analyst');
	});

	test('does not return other companies sessions', async () => {
		addUnifiedSession({ company_id: 99 });

		const res = await request(makeApp())
			.get('/api/interviews/screening/sessions')
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(0);
	});

	test('filters by status query param', async () => {
		addUnifiedSession({ status: 'invited' });
		addUnifiedSession({ status: 'completed' });

		const res = await request(makeApp())
			.get('/api/interviews/screening/sessions?status=completed')
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(1);
		expect(res.body.sessions[0].status).toBe('completed');
	});
});
