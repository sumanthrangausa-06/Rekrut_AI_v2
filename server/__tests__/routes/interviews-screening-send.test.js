/**
 * Full-branch review C2 (#322): POST /screening/send must write the unified
 * interview_sessions model, not the legacy screening_sessions table.
 *
 * After the cutover, /screening/:token redirects to /interview/session/:token,
 * which resolves ONLY via interview_sessions (GET /interview-sessions/by-token).
 * A manual send that still inserts into screening_sessions produces a dead
 * invite link ("Invite not found").
 *
 * Desired behavior: the send inserts type='screening' into interview_sessions
 * with the frozen engine config (mirroring the auto-send hook), the duplicate
 * check runs against interview_sessions, and invite_url points at the unified
 * page. The legacy /screening/session/:token/* endpoints stay for in-flight
 * pre-migration sessions (not covered here).
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

const mockNotifyUser = jest.fn();
jest.mock('../../../lib/notify', () => ({
	notifyUser: (...args) => mockNotifyUser(...args),
}));

// Real insertAuditLog (routes/audit.js) against the mocked DB — the audit
// INSERT is captured below like the other interview tests do.
const db = require('../../../lib/db');

const templates = new Map();
const jobs = new Map();
const sessions = new Map();
let nextSessionId = 1;
const auditRows = [];
let legacyWrites = 0;

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

	if (normalized.includes('from screening_sessions where template_id =')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.startsWith('insert into screening_sessions')) {
		legacyWrites += 1;
		return { rows: [{ id: 9000 + legacyWrites }], rowCount: 1 };
	}
	if (normalized.startsWith('insert into interview_sessions')) {
		const row = {
			id: nextSessionId++,
			type: params[0],
			job_id: params[1],
			application_id: params[2],
			candidate_id: params[3],
			company_id: params[4],
			triggered_by: params[5],
			invite_token: params[6],
			status: 'invited',
			config: maybeParse(params[7]),
			conversation: maybeParse(params[8]),
			created_at: new Date().toISOString(),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where invite_token =')) {
		const row = [...sessions.values()].find((s) => s.invite_token === params[0]);
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where application_id =')) {
		const rows = [...sessions.values()].filter(
			(s) =>
				Number(s.application_id) === Number(params[0]) &&
				(!normalized.includes("type = 'screening'") || s.type === 'screening'),
		);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.includes('from screening_templates where id =')) {
		const row = templates.get(Number(params[0]));
		const ok = row && Number(row.company_id) === Number(params[1]);
		return { rows: ok ? [{ ...row }] : [], rowCount: ok ? 1 : 0 };
	}
	if (normalized.includes('from jobs where id =')) {
		const row = jobs.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('insert into audit_logs')) {
		auditRows.push({
			company_id: params[0],
			actor_id: params[1],
			target_id: params[2],
			action: params[3],
			metadata: maybeParse(params[5]),
		});
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('update job_applications set')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into notifications')) {
		return { rows: [], rowCount: 1 };
	}
	throw new Error(`unexpected SQL in screening-send test mock: ${sql}`);
});

const interviewsRoutes = require('../../../routes/interviews');
const interviewSessionRoutes = require('../../../routes/interview-sessions');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRoutes);
	app.use('/api/interviews', interviewSessionRoutes);
	return app;
}

const RECRUITER = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 5 };

beforeEach(() => {
	templates.clear();
	jobs.clear();
	sessions.clear();
	auditRows.length = 0;
	nextSessionId = 1;
	legacyWrites = 0;
	global.__testUsers = { 2: RECRUITER };
	mockNotifyUser.mockReset();
	templates.set(1, {
		id: 1,
		company_id: 5,
		job_id: 10,
		title: 'Backend screening',
		topics: ['Node.js', 'System design'],
		questions: [{ question_text: 'Explain the event loop.' }],
		status: 'active',
	});
	jobs.set(10, {
		id: 10,
		company_id: 5,
		title: 'Backend Engineer',
		company_name: 'Acme',
		description: 'Node.js APIs',
	});
});

async function sendScreening(app, body = {}) {
	return request(app)
		.post('/api/interviews/screening/send')
		.set('x-test-user-id', '2')
		.send({ template_id: 1, candidate_id: 1, application_id: 20, job_id: 10, ...body });
}

describe('C2: POST /screening/send writes the unified model', () => {
	test('manual send creates an interview_sessions screening row, not a screening_sessions row', async () => {
		const app = buildApp();
		const res = await sendScreening(app);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(legacyWrites).toBe(0);
		expect(sessions.size).toBe(1);
		const session = [...sessions.values()][0];
		expect(session.type).toBe('screening');
		expect(session.status).toBe('invited');
		expect(session.candidate_id).toBe(1);
		expect(session.company_id).toBe(5);
		expect(session.job_id).toBe(10);
		expect(session.application_id).toBe(20);
		expect(session.triggered_by).toBe(2);
		// Frozen engine config mirrors the auto-send hook (Task 2 contract).
		expect(session.config.question_source).toBe('template');
		expect(session.config.current_phase).toBe('intro');
		expect(session.config.job.title).toBe('Backend Engineer');
		expect(session.config.template.topics).toEqual(['Node.js', 'System design']);
		expect(session.config.template.questions).toEqual([
			{ question_text: 'Explain the event loop.' },
		]);
	});

	test('invite_url points at the unified session page and the token resolves', async () => {
		const app = buildApp();
		const res = await sendScreening(app);

		expect(res.body.invite_url).toMatch(/^\/interview\/session\/[0-9a-f]{64}$/);
		const token = res.body.invite_url.split('/').pop();

		const resolved = await request(app).get(`/api/interviews/interview-sessions/by-token/${token}`);
		expect(resolved.status).toBe(200);
		expect(resolved.body.success).toBe(true);
		expect(resolved.body.session.type).toBe('screening');
		expect(resolved.body.session.job.title).toBe('Backend Engineer');
		// Redacted: no conversation, no full config, no resume.
		expect(resolved.body.session.conversation).toBeUndefined();
	});

	test('duplicate manual send is rejected via the unified table', async () => {
		const app = buildApp();
		const first = await sendScreening(app);
		expect(first.status).toBe(200);

		const second = await sendScreening(app);
		expect(second.status).toBe(409);
		expect(sessions.size).toBe(1);
	});

	test('manual send emits a session.sent audit event with the recruiter as actor', async () => {
		const app = buildApp();
		await sendScreening(app);

		const sent = auditRows.filter((r) => r.action === 'session.sent');
		expect(sent).toHaveLength(1);
		expect(sent[0].actor_id).toBe(2);
		expect(sent[0].company_id).toBe(5);
		expect(sent[0].metadata.type).toBe('screening');
	});
});
