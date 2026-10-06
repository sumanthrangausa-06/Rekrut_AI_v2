/**
 * Task 11 — interview audit events (issue #322).
 *
 * Every interview lifecycle transition emits an event into the company audit
 * log, following the #251 pattern exactly: routes/audit.js insertAuditLog →
 * audit_logs(company_id, actor_id, target_id, action, reason, metadata,
 * created_at). Each event carries the actor (actor_id) and a timestamp
 * (created_at). Emission is non-blocking: an audit-write failure is logged
 * and never fails the primary operation.
 *
 * Events under test:
 *   flow.created / flow.updated                        (interview-flow CRUD)
 *   session.sent                                       (recruiter trigger)
 *   session.started / session.completed / session.scored (start → complete)
 *   report.viewed                                      (Task 9 report view:
 *                                                       recording endpoint read)
 *
 * There is no live Postgres in this environment (and the shared Neon DB is
 * off-limits), so the DB layer is the repo's standard mocked lib/db
 * (server/test/setup.js) extended here with in-memory interview-domain
 * stores plus an audit_logs capture. AI boundaries are mocked:
 *   - services/conversation-engine (conductTurn)
 *   - services/interview-ai (generateScreeningReport)
 *   - server/services/livekit (findRecordingBySessionId, createRecordingRecord)
 *   - lib/notify (notifyUser)
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

// ─── AI / side-effect boundaries ────────────────────────────────────────────
const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
}));

const mockGenerateReport = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
}));

jest.mock('../../../server/services/livekit', () => ({
	findRecordingBySessionId: jest.fn().mockResolvedValue(null),
	createRecordingRecord: jest.fn().mockImplementation(async ({ interviewSessionId }) => ({
		id: 7000 + interviewSessionId,
		interview_session_id: interviewSessionId,
		status: 'pending',
		started_at: null,
	})),
	hasActiveConsent: jest.fn().mockResolvedValue(true),
}));

const mockNotifyUser = jest.fn();
jest.mock('../../../lib/notify', () => ({
	notifyUser: (...args) => mockNotifyUser(...args),
}));

// ─── In-memory stores (extends the global mocked lib/db) ────────────────────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
let nextSessionId = 1;
const flows = new Map();
let nextFlowId = 1;
const auditLogRows = [];
let nextAuditId = 1;
const jobs = new Map();
const applications = new Map();
// Test hook: when true, the audit_logs insert throws (proves non-blocking).
let failAuditWrites = false;

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

function applySetAssignments(row, normalized, params) {
	const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
	for (const assignment of setPart.split(',')) {
		const trimmed = assignment.trim();
		const paramMatch = trimmed.match(/^(\w+)\s*=\s*\$(\d+)$/);
		if (paramMatch) {
			row[paramMatch[1]] = maybeParse(params[Number(paramMatch[2]) - 1]);
			continue;
		}
		const literalMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
		if (literalMatch) {
			row[literalMatch[1]] = literalMatch[2];
			continue;
		}
		if (/^\w+\s*=\s*now\(\)$/.test(trimmed)) {
			row[trimmed.split('=')[0].trim()] = new Date().toISOString();
		}
	}
}

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	// ─── The assertion target: every audit_logs write is captured ───
	if (normalized.startsWith('insert into audit_logs')) {
		if (failAuditWrites) throw new Error('audit_logs unavailable (simulated)');
		// routes/audit.js insertAuditLog SQL:
		// (company_id, actor_id, target_id, action, reason, metadata, created_at)
		// VALUES ($1,$2,$3,$4,$5,$6,NOW())
		const row = {
			id: nextAuditId++,
			company_id: params[0],
			actor_id: params[1],
			target_id: params[2],
			action: params[3],
			reason: params[4],
			metadata: maybeParse(params[5]),
			created_at: new Date().toISOString(),
		};
		auditLogRows.push(row);
		return { rows: [], rowCount: 1 };
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
			frame_analysis: null,
			started_at: null,
			completed_at: null,
			created_at: new Date().toISOString(),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where id =')) {
		const row = sessions.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where application_id =')) {
		const rows = [...sessions.values()].filter(
			(s) => Number(s.application_id) === Number(params[0]) && s.type === 'ai_interview',
		);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const row = sessions.get(Number(params[params.length - 1]));
		if (!row) return { rows: [], rowCount: 0 };
		applySetAssignments(row, normalized, params);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('insert into interview_flows')) {
		const row = {
			id: nextFlowId++,
			company_id: params[0],
			job_id: params[1],
			created_by: params[2],
			name: params[3],
			type: params[4],
			description: params[5],
			phases: maybeParse(params[6]),
			topics: maybeParse(params[7]),
			questions: maybeParse(params[8]),
			rubric_weights: maybeParse(params[9]),
			triggers: maybeParse(params[10]),
			status: 'active',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		flows.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_flows where id =')) {
		const row = flows.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_flows set')) {
		const row = flows.get(Number(params[params.length - 1]));
		if (!row) return { rows: [], rowCount: 0 };
		applySetAssignments(row, normalized, params);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from jobs where id =')) {
		const row = jobs.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from job_applications where id =')) {
		const row = applications.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from parsed_resumes')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.includes('from question_bank')) {
		return { rows: [], rowCount: 0 };
	}
	return baseQueryImpl(sql, params);
});

// ─── App under test ─────────────────────────────────────────────────────────
const interviewSessionRoutes = require('../../../routes/interview-sessions');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewSessionRoutes);
	return app;
}

const CANDIDATE = { id: 1, email: 'cand@test.com', role: 'candidate' };
const RECRUITER = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 5 };

function events(action) {
	return auditLogRows.filter((r) => r.action === action);
}

function seedJobAndApplication() {
	jobs.set(10, {
		id: 10,
		company_id: 5,
		title: 'Backend Engineer',
		description: 'Node.js APIs',
		company_name: 'Acme',
	});
	applications.set(20, { id: 20, job_id: 10, candidate_id: 1 });
}

async function triggerSession(app) {
	return request(app)
		.post('/api/interviews/interview-sessions/trigger')
		.set('x-test-user-id', '2')
		.send({ application_id: 20 });
}

beforeEach(() => {
	sessions.clear();
	flows.clear();
	auditLogRows.length = 0;
	jobs.clear();
	applications.clear();
	nextSessionId = 1;
	nextFlowId = 1;
	nextAuditId = 1;
	failAuditWrites = false;
	global.__testUsers = { 1: CANDIDATE, 2: RECRUITER };
	mockNotifyUser.mockReset();
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockConductTurn.mockResolvedValue({
		ai_message: 'Welcome! Tell me about yourself.',
		phase: 'intro',
		is_complete: false,
	});
	mockGenerateReport.mockResolvedValue({
		overall_score: 82,
		recommendation: 'advance',
		recommendation_reasoning: 'Strong backend depth.',
		strengths: [],
		red_flags: [],
		dimension_scores: {},
		key_moments: [],
		question_scores: [],
	});
});

describe('interview audit events (Task 11 / #322)', () => {
	test('session.sent is emitted with actor + timestamp when a recruiter triggers an interview', async () => {
		const app = buildApp();
		seedJobAndApplication();

		const res = await triggerSession(app);
		expect(res.status).toBe(201);
		const sessionId = res.body.session.id;

		const sent = events('session.sent');
		expect(sent).toHaveLength(1);
		expect(sent[0].actor_id).toBe(2); // the recruiter who triggered
		expect(sent[0].company_id).toBe(5);
		expect(sent[0].target_id).toBe(sessionId);
		expect(sent[0].metadata.session_id).toBe(sessionId);
		expect(sent[0].metadata.type).toBe('ai_interview');
		expect(sent[0].metadata.application_id).toBe(20);
		expect(Date.parse(sent[0].created_at)).toBeGreaterThan(Date.now() - 60_000);
	});

	test('flow.created is emitted with actor + timestamp on flow create', async () => {
		const app = buildApp();

		const res = await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send({ name: 'Engineering screening', type: 'screening' });
		expect(res.status).toBe(201);
		const flowId = res.body.flow.id;

		const created = events('flow.created');
		expect(created).toHaveLength(1);
		expect(created[0].actor_id).toBe(2);
		expect(created[0].company_id).toBe(5);
		expect(created[0].target_id).toBe(flowId);
		expect(created[0].metadata.flow_id).toBe(flowId);
		expect(created[0].metadata.name).toBe('Engineering screening');
		expect(Date.parse(created[0].created_at)).toBeGreaterThan(Date.now() - 60_000);
	});

	test('flow.updated is emitted with actor + timestamp on flow update', async () => {
		const app = buildApp();
		const create = await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send({ name: 'Engineering screening', type: 'screening' });
		expect(create.status).toBe(201);
		const flowId = create.body.flow.id;

		const res = await request(app)
			.put(`/api/interviews/interview-flows/${flowId}`)
			.set('x-test-user-id', '2')
			.send({ description: 'Updated rubric' });
		expect(res.status).toBe(200);

		const updated = events('flow.updated');
		expect(updated).toHaveLength(1);
		expect(updated[0].actor_id).toBe(2);
		expect(updated[0].company_id).toBe(5);
		expect(updated[0].target_id).toBe(flowId);
		expect(updated[0].metadata.flow_id).toBe(flowId);
		expect(Date.parse(updated[0].created_at)).toBeGreaterThan(Date.now() - 60_000);
	});

	test('start → complete emits session.started, session.completed and session.scored', async () => {
		const app = buildApp();
		seedJobAndApplication();

		const triggered = await triggerSession(app);
		expect(triggered.status).toBe(201);
		const sessionId = triggered.body.session.id;

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/start`)
			.set('x-test-user-id', '1');
		expect(started.status).toBe(200);

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/complete`)
			.set('x-test-user-id', '1');
		expect(completed.status).toBe(200);

		const startedEvents = events('session.started');
		expect(startedEvents).toHaveLength(1);
		expect(startedEvents[0].actor_id).toBe(1); // the candidate started it
		expect(startedEvents[0].company_id).toBe(5);
		expect(startedEvents[0].target_id).toBe(sessionId);
		expect(startedEvents[0].metadata.session_id).toBe(sessionId);

		const completedEvents = events('session.completed');
		expect(completedEvents).toHaveLength(1);
		expect(completedEvents[0].actor_id).toBe(1);
		expect(completedEvents[0].target_id).toBe(sessionId);

		const scoredEvents = events('session.scored');
		expect(scoredEvents).toHaveLength(1);
		expect(scoredEvents[0].actor_id).toBe(1);
		expect(scoredEvents[0].target_id).toBe(sessionId);
		expect(scoredEvents[0].metadata.overall_score).toBe(82);
		expect(scoredEvents[0].metadata.recommendation).toBe('advance');

		// No cross-talk: exactly one audit row per lifecycle event.
		expect(auditLogRows).toHaveLength(4); // sent, started, completed, scored
	});

	test('report.viewed is emitted when the recruiter reads the session recording', async () => {
		const app = buildApp();
		seedJobAndApplication();

		const triggered = await triggerSession(app);
		expect(triggered.status).toBe(201);
		const sessionId = triggered.body.session.id;

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${sessionId}/recording`)
			.set('x-test-user-id', '2');
		expect(res.status).toBe(200);

		const viewed = events('report.viewed');
		expect(viewed).toHaveLength(1);
		expect(viewed[0].actor_id).toBe(2);
		expect(viewed[0].company_id).toBe(5);
		expect(viewed[0].target_id).toBe(sessionId);
		expect(viewed[0].metadata.session_id).toBe(sessionId);
	});

	test('audit-write failure never breaks the primary operation', async () => {
		const app = buildApp();
		seedJobAndApplication();
		failAuditWrites = true;

		const triggered = await triggerSession(app);
		expect(triggered.status).toBe(201);
		const sessionId = triggered.body.session.id;
		expect(sessions.has(sessionId)).toBe(true);

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/start`)
			.set('x-test-user-id', '1');
		expect(started.status).toBe(200);
		expect(started.body.session.status).toBe('in_progress');

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/complete`)
			.set('x-test-user-id', '1');
		expect(completed.status).toBe(200);
		expect(completed.body.session.status).toBe('completed');
		expect(completed.body.report.overall_score).toBe(82);

		// Nothing was written to the audit log, but the flow succeeded.
		expect(auditLogRows).toHaveLength(0);
	});
});
