/**
 * Screening completion flow (Track A fixes).
 *
 * RED-proven tests for:
 *  A1: POST /interview-sessions/:id/respond returns the candidate's transcript
 *  A2: POST /interview-sessions/:id/complete updates job_applications.screening_status
 *  A3: GET /interview-sessions/:id/report is candidate-scoped
 *
 * Same hermetic pattern as interview-sessions.test.js: supertest against the
 * router, in-memory interview_sessions store, AI boundaries mocked.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass ────────────────────────────────────────────────────────────
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

// ─── AI boundaries ──────────────────────────────────────────────────────────
const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
	selectQuestionSource: jest.fn(() => 'template'),
	TURN_TIMEOUT_MS: 20000,
}));

const mockGenerateReport = jest.fn();
const mockRunMultiEvaluation = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
	runMultiEvaluation: (...args) => mockRunMultiEvaluation(...args),
}));

jest.mock('../../../lib/ai-provider', () => ({
	transcribeAudio: jest.fn(),
}));

jest.mock('../../../lib/polsia-ai', () => ({
	textToSpeech: jest.fn(),
}));

jest.mock('livekit-server-sdk', () => {
	const actual = jest.requireActual('livekit-server-sdk');
	return {
		...actual,
		EgressClient: jest.fn(() => ({
			startRoomCompositeEgress: jest.fn(),
			stopEgress: jest.fn(async (egressId) => ({ egressId, status: 'EGRESS_COMPLETE' })),
			listEgress: jest.fn(async () => []),
		})),
	};
});

process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn(),
}));

// ─── In-memory stores ───────────────────────────────────────────────────────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
let nextSessionId = 1;
const applications = new Map();
const recordedAppUpdates = [];

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

db.query.mockImplementation(async (sql, params) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	const p = params || [];

	if (normalized.startsWith('insert into interview_sessions')) {
		const row = {
			id: nextSessionId++,
			type: p[0],
			job_id: p[1],
			application_id: p[2],
			candidate_id: p[3],
			company_id: p[4],
			triggered_by: p[5],
			invite_token: p[6],
			status: 'invited',
			config: maybeParse(p[7]),
			conversation: maybeParse(p[8]),
			started_at: null,
			completed_at: null,
			created_at: new Date().toISOString(),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where id =')) {
		const row = sessions.get(Number(p[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
		const id = Number(p[p.length - 1]);
		const row = sessions.get(id);
		if (!row) return { rows: [], rowCount: 0 };
		// #1541: emulate Postgres semantics for the transition guard —
		// `AND status <> 'completed'` matches 0 rows on a completed row.
		if (normalized.includes("status <> 'completed'") && row.status === 'completed') {
			return { rows: [], rowCount: 0 };
		}
		for (const assignment of setPart.split(',')) {
			const trimmed = assignment.trim();
			const mergeMatch = trimmed.match(/^(\w+)\s*=\s*\1\s*\|\|\s*\$(\d+)(::\w+)?$/);
			if (mergeMatch) {
				const delta = maybeParse(p[Number(mergeMatch[2]) - 1]) || {};
				row[mergeMatch[1]] = { ...(row[mergeMatch[1]] || {}), ...delta };
				continue;
			}
			const paramMatch = trimmed.match(/^(\w+)\s*=\s*\$(\d+)$/);
			if (paramMatch) {
				row[paramMatch[1]] = maybeParse(p[Number(paramMatch[2]) - 1]);
				continue;
			}
			const literalMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
			if (literalMatch) {
				row[literalMatch[1]] = literalMatch[2];
				continue;
			}
			const nowMatch = trimmed.match(/^(\w+)\s*=\s*now\(\)$/);
			if (nowMatch) row[nowMatch[1]] = new Date().toISOString();
		}
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('update job_applications set')) {
		recordedAppUpdates.push({ normalized, params: [...p] });
		const id = Number(p[p.length - 1]);
		const row = applications.get(id);
		if (row) {
			const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
			for (const assignment of setPart.split(',')) {
				const trimmed = assignment.trim();
				const paramMatch = trimmed.match(/^(\w+)\s*=\s*\$(\d+)$/);
				if (paramMatch) {
					row[paramMatch[1]] = p[Number(paramMatch[2]) - 1];
					continue;
				}
				const literalMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
				if (literalMatch) {
					row[literalMatch[1]] = literalMatch[2];
					continue;
				}
				const nowMatch = trimmed.match(/^(\w+)\s*=\s*now\(\)$/);
				if (nowMatch) row[nowMatch[1]] = new Date().toISOString();
			}
		}
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from job_applications where id =')) {
		const row = applications.get(Number(p[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from jobs where id =')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.includes('from interview_recordings')) {
		return { rows: [], rowCount: 0 };
	}
	if (
		normalized.includes('insert into audit_logs') ||
		normalized.includes('insert into interview_audit')
	) {
		return { rows: [], rowCount: 1 };
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
const OTHER_CANDIDATE = { id: 3, email: 'other@test.com', role: 'candidate' };

function screeningConfig() {
	return {
		question_source: 'template',
		job: { title: 'Backend Engineer', company_name: 'Acme' },
		template: { topics: ['experience'], questions: [] },
		current_phase: 'intro',
	};
}

async function createSession(app, overrides = {}) {
	const res = await request(app)
		.post('/api/interviews/interview-sessions')
		.set('x-test-user-id', '1')
		.send({
			type: 'screening',
			job_id: 10,
			application_id: 20,
			candidate_id: 1,
			company_id: 5,
			config: screeningConfig(),
			...overrides,
		});
	return res;
}

async function startAndRespond(app, id, text = 'I have five years of backend experience.') {
	await request(app)
		.post(`/api/interviews/interview-sessions/${id}/start`)
		.set('x-test-user-id', '1')
		.send();
	return request(app)
		.post(`/api/interviews/interview-sessions/${id}/respond`)
		.set('x-test-user-id', '1')
		.send({ text });
}

beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	applications.clear();
	recordedAppUpdates.length = 0;
	// Seed the linked application (mirrors createSession's application_id: 20)
	applications.set(20, { id: 20, candidate_id: 1, job_id: 10, screening_status: 'invited' });
	global.__testUsers = { 1: CANDIDATE, 3: OTHER_CANDIDATE };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockRunMultiEvaluation.mockReset();
	mockRunMultiEvaluation.mockResolvedValue({ evaluations: {}, composite: { composite_score: 80 } });
	mockConductTurn.mockResolvedValue({
		ai_message: 'Thanks. Tell me about a challenging project.',
		phase: 'background',
		is_complete: false,
	});
	mockGenerateReport.mockResolvedValue({
		overall_score: 82,
		recommendation: 'advance',
		recommendation_reasoning: 'Strong backend depth.',
		strengths: ['concrete examples'],
		red_flags: [],
		dimension_scores: { technical_depth: { score: 85, feedback: 'Solid' } },
		key_moments: [],
		question_scores: [],
	});
});

async function waitForFire(n = 1, ms = 1500) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (mockRunMultiEvaluation.mock.calls.length >= n) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return mockRunMultiEvaluation.mock.calls.length >= n;
}

async function complete(app, id) {
	return request(app)
		.post(`/api/interviews/interview-sessions/${id}/complete`)
		.set('x-test-user-id', '1')
		.send();
}

describe('#1541 branch-(c) multi-evaluation fire', () => {
	it('screening completion fires runMultiEvaluation exactly once with the unified linkage context', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id, 'I have five years of backend experience building APIs and leading migrations.');
		const res = await complete(app, id);
		expect(res.status).toBe(200);
		expect(await waitForFire(1)).toBe(true);
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(1);
		const [candidateId, jobId, companyId, ctx] = mockRunMultiEvaluation.mock.calls[0];
		expect(candidateId).toBe(1);
		expect(jobId).toBe(10);
		expect(companyId).toBe(5);
		expect(ctx.interviewSessionId).toBe(id);
		expect(ctx.interviewId).toBeUndefined();
		expect(ctx.screeningSessionId).toBeUndefined();
		expect(Array.isArray(ctx.conversation)).toBe(true);
	});

	it('ai_interview completion fires', async () => {
		const app = buildApp();
		const created = await createSession(app, { type: 'ai_interview' });
		const id = created.body.session.id;
		await startAndRespond(app, id, 'I designed and shipped a payments platform used by thousands of customers daily.');
		const res = await complete(app, id);
		expect(res.status).toBe(200);
		expect(await waitForFire(1)).toBe(true);
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(1);
	});

	it('practice completion never fires (practice-separation ruling)', async () => {
		const app = buildApp();
		const created = await createSession(app, { type: 'practice' });
		const id = created.body.session.id;
		await startAndRespond(app, id, 'Practice answer with plenty of detail about my projects and experience.');
		const res = await complete(app, id);
		expect(res.status).toBe(200);
		await new Promise((r) => setTimeout(r, 250));
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(0);
	});

	it('human completion never fires (no-data branch)', async () => {
		const app = buildApp();
		// Human sessions are created by the hiring team, not candidates —
		// seed the row directly (observer-suite pattern).
		const id = 9901;
		sessions.set(id, {
			id, type: 'human', job_id: 10, application_id: null, candidate_id: 1,
			company_id: 5, status: 'in_progress', config: {}, conversation: [],
			invite_token: 'tok-human', created_at: new Date().toISOString(),
		});
		const res = await complete(app, id);
		expect(res.status).toBe(200);
		expect(res.body.report.overall_score).toBeNull();
		await new Promise((r) => setTimeout(r, 250));
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(0);
	});

	it('re-completing a completed session does not fire again', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id, 'Detailed answer covering architecture trade-offs and delivery outcomes.');
		await complete(app, id);
		expect(await waitForFire(1)).toBe(true);
		const again = await complete(app, id);
		expect(again.status).toBe(200);
		expect(again.body.already_completed).toBe(true);
		await new Promise((r) => setTimeout(r, 250));
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(1);
	});

	it('concurrent completes fire exactly once; the loser gets already_completed', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id, 'A thorough answer about scaling systems and mentoring engineers.');
		mockGenerateReport.mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 60));
			return { overall_score: 82, recommendation: 'advance' };
		});
		const [r1, r2] = await Promise.all([complete(app, id), complete(app, id)]);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		const flags = [r1.body.already_completed === true, r2.body.already_completed === true];
		expect(flags.filter(Boolean).length).toBe(1);
		expect(await waitForFire(1)).toBe(true);
		await new Promise((r) => setTimeout(r, 250));
		expect(mockRunMultiEvaluation.mock.calls.length).toBe(1);
	});

	it('evaluation failure never fails completion', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id, 'Strong detailed answer about incident response and reliability work.');
		mockRunMultiEvaluation.mockRejectedValue(new Error('provider down'));
		const res = await complete(app, id);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(await waitForFire(1)).toBe(true);
	});
});
