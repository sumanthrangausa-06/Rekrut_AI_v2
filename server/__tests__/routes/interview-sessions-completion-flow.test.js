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
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
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

describe('A1: respond returns the candidate transcript', () => {
	it('includes transcript in the respond response JSON', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1')
			.send();

		const text = 'I led the migration of our monolith to microservices.';
		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text });

		expect(res.status).toBe(200);
		// The frontend reads data.transcript to render the interviewee's words
		expect(res.body.transcript).toBe(text);
	});
});

describe('A2: complete updates job_applications.screening_status', () => {
	it('sets screening_status=completed with score on the linked application', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id);

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/complete`)
			.set('x-test-user-id', '1')
			.send();

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const appRow = applications.get(20);
		expect(appRow.screening_status).toBe('completed');
		expect(appRow.screening_score).toBe(82);
	});

	it('does not fail when the session has no linked application', async () => {
		const app = buildApp();
		const created = await createSession(app, { application_id: null });
		const id = created.body.session.id;
		await startAndRespond(app, id);

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/complete`)
			.set('x-test-user-id', '1')
			.send();

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(recordedAppUpdates).toHaveLength(0);
	});
});

describe('A3: candidate report endpoint', () => {
	async function completeSession(app) {
		const created = await createSession(app);
		const id = created.body.session.id;
		await startAndRespond(app, id);
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/complete`)
			.set('x-test-user-id', '1')
			.send();
		return id;
	}

	it('returns the report to the owning candidate', async () => {
		const app = buildApp();
		const id = await completeSession(app);

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${id}/report`)
			.set('x-test-user-id', '1')
			.send();

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.report).toMatchObject({
			overall_score: 82,
			recommendation: 'advance',
		});
		// Candidate-facing feedback present, internal fields absent
		expect(res.body.report.strengths).toEqual(['concrete examples']);
	});

	it('denies a different candidate', async () => {
		const app = buildApp();
		const id = await completeSession(app);

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${id}/report`)
			.set('x-test-user-id', '3')
			.send();

		expect([403, 404]).toContain(res.status);
	});

	it('returns 404 for a nonexistent session', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-sessions/99999/report')
			.set('x-test-user-id', '1')
			.send();

		expect(res.status).toBe(404);
	});
});
