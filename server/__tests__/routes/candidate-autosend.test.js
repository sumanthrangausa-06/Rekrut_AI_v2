/**
 * Task 5 — auto-send hook migration + threshold falsy-bug fix (issue #322).
 *
 * The apply hook (routes/candidate.js submitApplication) must:
 *  1. treat auto_send_min_score: 0 as a valid threshold (not coerce to 70);
 *  2. write auto-sent screenings to interview_sessions (type='screening'),
 *     not the legacy screening_sessions table;
 *  3. freeze the engine config (question_source='template' + job/template/
 *     current_phase) at creation;
 *  4. create exactly one session on double-apply (idempotency).
 *
 * There is no live Postgres in this environment (and the shared Neon DB is
 * off-limits), so the DB layer is the repo's standard mocked lib/db
 * (server/test/setup.js) extended here with in-memory apply-flow stores.
 * The scoring boundary is mocked: services/matching-engine
 * (calculateDeterministicMatch) — the hook's threshold comparison and write
 * target are what's under test, not the scorer itself.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass (same pattern as company-approval.test.js) ─────────────────
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

// ─── Scoring boundary ───────────────────────────────────────────────────────
const mockCalculateMatch = jest.fn();
jest.mock('../../../services/matching-engine', () => ({
	calculateDeterministicMatch: (...args) => mockCalculateMatch(...args),
}));

// ─── Side-effect boundaries (non-blocking in production) ────────────────────
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../routes/chat', () => ({
	getOrCreateConversation: jest.fn().mockResolvedValue({ id: 1 }),
}));

// ─── In-memory apply-flow store (extends the global mocked lib/db) ──────────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

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

const store = {
	users: new Map(),
	jobs: new Map(),
	applications: [],
	templates: [],
	flows: [], // interview_flows rows (Task 10 cutover)
	sessions: [], // interview_sessions rows
	legacySessions: [], // screening_sessions rows (old code path)
	notifications: [],
	auditEvents: [], // audit_logs rows (Task 11)
	nextId: 1,
};

function resetStore() {
	store.users.clear();
	store.jobs.clear();
	store.applications.length = 0;
	store.templates.length = 0;
	store.flows.length = 0;
	store.sessions.length = 0;
	store.legacySessions.length = 0;
	store.notifications.length = 0;
	store.auditEvents.length = 0;
	store.nextId = 1;
	store.users.set(1, {
		id: 1,
		name: 'Test Candidate',
		email: 'candidate@test.com',
		stripe_subscription_id: null,
	});
}

/** Parse a simple INSERT ... (cols) VALUES (...) into a row object. */
function parseInsert(normalized, params) {
	const colsMatch = normalized.match(/insert into \w+ \(([^)]+)\)/);
	const valsMatch = normalized.match(/values \(([^)]+)\)/);
	const row = { id: store.nextId++ };
	if (!colsMatch || !valsMatch) return row;
	const cols = colsMatch[1].split(',').map((s) => s.trim());
	const vals = valsMatch[1].split(',').map((s) => s.trim());
	let ci = 0;
	for (const v of vals) {
		const m = /^\$(\d+)$/.exec(v);
		if (m) {
			row[cols[ci]] = maybeParse(params[parseInt(m[1], 10) - 1]);
		} else if (/^'.*'$/.test(v)) {
			row[cols[ci]] = v.slice(1, -1);
		} else if (v === 'now()') {
			row[cols[ci]] = new Date().toISOString();
		}
		ci++;
	}
	return row;
}

function installDbMock() {
	db.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// Profile + omniscore lookup
		if (
			normalized.includes('from users u') &&
			normalized.includes('left join candidate_profiles')
		) {
			const user = store.users.get(Number(params[0]));
			if (!user) return { rows: [], rowCount: 0 };
			return {
				rows: [{ ...user, omniscore: null }],
				rowCount: 1,
			};
		}
		// Skills
		if (normalized.includes('from candidate_skills where user_id')) {
			return { rows: [], rowCount: 0 };
		}
		// Job lookup
		if (normalized.startsWith('select * from jobs where id =')) {
			const job = store.jobs.get(Number(params[0]));
			return { rows: job ? [{ ...job }] : [], rowCount: job ? 1 : 0 };
		}
		// Existing application (duplicate-apply guard)
		if (normalized.includes('from job_applications where candidate_id =')) {
			const rows = store.applications.filter(
				(a) =>
					Number(a.candidate_id) === Number(params[0]) && Number(a.job_id) === Number(params[1]),
			);
			return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
		}
		// Stripe subscription id
		if (normalized.includes('select stripe_subscription_id from users where id =')) {
			return { rows: [{ stripe_subscription_id: null }], rowCount: 1 };
		}
		// Application insert
		if (normalized.startsWith('insert into job_applications')) {
			const row = parseInsert(normalized, params);
			row.screening_status = null;
			store.applications.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		// Idempotency guard — new table (post-fix)
		if (normalized.includes('from interview_sessions where application_id =')) {
			const rows = store.sessions.filter((s) => Number(s.application_id) === Number(params[0]));
			return { rows: rows.map((r) => ({ id: r.id })), rowCount: rows.length };
		}
		// Idempotency guard — legacy table (pre-fix code path)
		if (normalized.includes('from screening_sessions where application_id =')) {
			const rows = store.legacySessions.filter(
				(s) => Number(s.application_id) === Number(params[0]),
			);
			return { rows: rows.map((r) => ({ id: r.id })), rowCount: rows.length };
		}
		// Active template lookup (legacy fallback)
		if (normalized.includes('from screening_templates where job_id =')) {
			const rows = store.templates
				.filter((t) => Number(t.job_id) === Number(params[0]) && t.status === 'active')
				.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
			return { rows: rows.slice(0, 1).map((r) => ({ ...r })), rowCount: Math.min(rows.length, 1) };
		}
		// Active interview flow lookup (Task 10 cutover — preferred over screening_templates)
		if (normalized.includes('from interview_flows where job_id =')) {
			const rows = store.flows
				.filter(
					(f) =>
						Number(f.job_id) === Number(params[0]) &&
						f.type === 'screening' &&
						f.status === 'active',
				)
				.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
			return { rows: rows.slice(0, 1).map((r) => ({ ...r })), rowCount: Math.min(rows.length, 1) };
		}
		// Session insert — new table (post-fix)
		if (normalized.startsWith('insert into interview_sessions')) {
			const row = parseInsert(normalized, params);
			store.sessions.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		// Session insert — legacy table (pre-fix code path)
		if (normalized.startsWith('insert into screening_sessions')) {
			const row = parseInsert(normalized, params);
			store.legacySessions.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		// Screening status update
		if (normalized.includes('update job_applications set screening_status')) {
			const app = store.applications.find((a) => Number(a.id) === Number(params[0]));
			if (app) app.screening_status = 'invited';
			return { rows: [], rowCount: app ? 1 : 0 };
		}
		// Notification insert
		if (normalized.startsWith('insert into notifications')) {
			const row = parseInsert(normalized, params);
			store.notifications.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		// Company audit log (Task 11 — routes/audit.js insertAuditLog).
		// Dedicated parse: the generic parseInsert chokes on the trailing
		// NOW() (its values regex stops at NOW's own closing paren).
		if (normalized.startsWith('insert into audit_logs')) {
			const row = {
				id: store.nextId++,
				company_id: params[0],
				actor_id: params[1],
				target_id: params[2],
				action: params[3],
				reason: params[4],
				metadata: maybeParse(params[5]),
				created_at: new Date().toISOString(),
			};
			store.auditEvents.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		// Recruiter id lookup for notifications
		if (normalized.startsWith('select user_id from jobs where id =')) {
			return { rows: [{ user_id: null }], rowCount: 1 };
		}
		// Recruiter lookup for emails
		if (normalized.includes('from users u join jobs j')) {
			return { rows: [], rowCount: 0 };
		}

		// Everything else: the repo's standard mock
		if (baseQueryImpl) return baseQueryImpl(sql, params);
		return { rows: [], rowCount: 0 };
	});
}

function seedJob(overrides = {}) {
	const job = {
		id: 10,
		title: 'Backend Engineer',
		company: 'Acme',
		company_name: 'Acme Inc',
		description: 'Build APIs.',
		company_id: 7,
		user_id: null,
		auto_send_on_apply: true,
		auto_send_min_score: 0,
		...overrides,
	};
	store.jobs.set(job.id, job);
	return job;
}

function seedTemplate(overrides = {}) {
	const template = {
		id: 5,
		job_id: 10,
		status: 'active',
		title: 'Standard screening',
		topics: ['experience', 'motivation'],
		questions: [{ question_text: 'Tell me about yourself.' }],
		created_at: new Date().toISOString(),
		...overrides,
	};
	store.templates.push(template);
	return template;
}

function seedFlow(overrides = {}) {
	const flow = {
		id: 9,
		job_id: 10,
		company_id: 7,
		status: 'active',
		type: 'screening',
		name: 'Flow screening',
		topics: ['flow-topic-a', 'flow-topic-b'],
		questions: [{ question_text: 'Flow question?' }],
		created_at: new Date().toISOString(),
		...overrides,
	};
	store.flows.push(flow);
	return flow;
}

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', require('../../../routes/candidate'));
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	resetStore();
	installDbMock();
	global.__testUsers = { 1: { id: 1, role: 'candidate', email: 'candidate@test.com' } };
	mockCalculateMatch.mockReturnValue({ match_score: 65 });
});

describe('POST /api/candidate/jobs/:jobId/apply — auto-send screening', () => {
	it('creates a unified screening session when the score meets a zero threshold', async () => {
		seedJob({ auto_send_min_score: 0 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 65 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		// Threshold 0 is valid: 65 >= 0 must create a session (the || 70 bug
		// coerced 0 -> 70 and created nothing).
		expect(store.sessions).toHaveLength(1);
		expect(store.legacySessions).toHaveLength(0);

		const session = store.sessions[0];
		expect(session.type).toBe('screening');
		expect(session.candidate_id).toBe(1);
		// req.params.jobId arrives as a string; Postgres coerces to INTEGER
		expect(Number(session.job_id)).toBe(10);
		expect(session.company_id).toBe(7);
		expect(session.application_id).toBe(store.applications[0].id);
		expect(session.status).toBe('invited');
		expect(session.invite_token).toMatch(/^[a-f0-9]{64}$/);

		// Engine config frozen at creation (Task 2 contract)
		expect(session.config.question_source).toBe('template');
		expect(session.config.current_phase).toBe('intro');
		expect(session.config.template.id).toBe(5);
		expect(session.config.template.topics).toEqual(['experience', 'motivation']);
		expect(session.config.job.title).toBe('Backend Engineer');

		// Application marked invited + candidate notified with the token
		expect(store.applications[0].screening_status).toBe('invited');
		const invite = store.notifications.find((n) => n.type === 'screening_invite');
		expect(invite).toBeDefined();
		// pg returns JSONB parsed (object) or TEXT (string) depending on the column
		const inviteData = typeof invite.data === 'string' ? JSON.parse(invite.data) : invite.data;
		expect(inviteData.invite_token).toBe(session.invite_token);
	});

	it('creates no session when the score is below the threshold', async () => {
		seedJob({ auto_send_min_score: 70 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 50 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		expect(store.sessions).toHaveLength(0);
		expect(store.legacySessions).toHaveLength(0);
		expect(store.applications[0].screening_status).not.toBe('invited');
	});

	it('creates exactly one session on double apply (idempotency)', async () => {
		seedJob({ auto_send_min_score: 0 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 80 });

		const app = buildApp();
		const first = await request(app)
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});
		expect(first.status).toBe(200);

		const second = await request(app)
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});
		expect(second.status).toBe(400);

		expect(store.sessions).toHaveLength(1);
		expect(store.legacySessions).toHaveLength(0);
	});

	it('does not auto-send when the job has auto-send disabled', async () => {
		seedJob({ auto_send_on_apply: false, auto_send_min_score: 0 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 95 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		expect(store.sessions).toHaveLength(0);
		expect(store.legacySessions).toHaveLength(0);
	});

	it("prefers the job's interview flow over the legacy screening template (Task 10 cutover)", async () => {
		seedJob({ auto_send_min_score: 0 });
		seedTemplate({ topics: ['legacy-topic'] });
		seedFlow();
		mockCalculateMatch.mockReturnValue({ match_score: 80 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		expect(store.sessions).toHaveLength(1);
		const session = store.sessions[0];
		expect(session.config.question_source).toBe('template');
		expect(session.config.template.id).toBe(9);
		expect(session.config.template.title).toBe('Flow screening');
		expect(session.config.template.topics).toEqual(['flow-topic-a', 'flow-topic-b']);
		expect(session.config.template.questions).toEqual([{ question_text: 'Flow question?' }]);
	});

	it('falls back to the legacy screening template when no interview flow exists', async () => {
		seedJob({ auto_send_min_score: 0 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 80 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		expect(store.sessions).toHaveLength(1);
		expect(store.sessions[0].config.template.id).toBe(5);
		expect(store.sessions[0].config.template.topics).toEqual(['experience', 'motivation']);
	});

	it('emits session.sent to the company audit log on auto-send (Task 11)', async () => {
		seedJob({ auto_send_min_score: 0 });
		seedTemplate();
		mockCalculateMatch.mockReturnValue({ match_score: 80 });

		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({});

		expect(res.status).toBe(200);
		expect(store.sessions).toHaveLength(1);
		const session = store.sessions[0];

		const sent = store.auditEvents.filter((e) => e.action === 'session.sent');
		expect(sent).toHaveLength(1);
		// System-triggered: no human actor.
		expect(sent[0].actor_id).toBeNull();
		expect(sent[0].company_id).toBe(7);
		expect(sent[0].target_id).toBe(session.id);
		// pg returns JSONB parsed (object) or TEXT (string) depending on the column
		const meta =
			typeof sent[0].metadata === 'string' ? JSON.parse(sent[0].metadata) : sent[0].metadata;
		expect(meta.session_id).toBe(session.id);
		expect(meta.type).toBe('screening');
		expect(meta.application_id).toBe(store.applications[0].id);
		expect(Date.parse(sent[0].created_at)).toBeGreaterThan(Date.now() - 60_000);
	});
});
