/**
 * Task 3 — unified interview-session endpoints (issue #322).
 *
 * Supertest against the interview-sessions router. There is no live Postgres
 * in this environment (and the shared Neon DB is off-limits), so the DB layer
 * is the repo's standard mocked lib/db (server/test/setup.js) extended here
 * with an in-memory interview_sessions store. AI boundaries are mocked:
 *   - services/conversation-engine (conductTurn) — the router's orchestration
 *     (auth, persistence per turn, report on complete) is what's under test;
 *     engine behavior itself was covered in Task 2.
 *   - services/interview-ai (generateScreeningReport) — external LLM.
 *   - lib/ai-provider (transcribeAudio) — external ASR.
 *   - lib/polsia-ai (textToSpeech) — external TTS.
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

// ─── AI boundaries ──────────────────────────────────────────────────────────
const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
	selectQuestionSource: jest.fn((s) =>
		s?.config?.question_source === 'personalized' ? 'personalized' : 'template',
	),
	TURN_TIMEOUT_MS: 20000,
}));

const mockGenerateReport = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
}));

const mockTranscribeAudio = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	transcribeAudio: (...args) => mockTranscribeAudio(...args),
}));

const mockTextToSpeech = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	textToSpeech: (...args) => mockTextToSpeech(...args),
}));

// ─── In-memory interview-domain store (extends the global mocked lib/db) ────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
let nextSessionId = 1;
const scheduledInterviews = [];
const interviewEvents = [];
// Conversation lengths seen by the (mocked) engine at call time, per test.
const engineSeenLengths = [];

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

function toRow(s) {
	// pg returns JSONB columns parsed; timestamptz as ISO strings
	return { ...s };
}

function handleSessionSql(normalized, params) {
	if (normalized.startsWith('insert into interview_sessions')) {
		// Router SQL: VALUES ($1,$2,$3,$4,$5,$6,$7,'invited',$8,$9) —
		// status is a literal, config=$8, conversation=$9.
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
		return { rows: [toRow(row)], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where id =')) {
		// pg coerces '1' to integer; the Map needs the same coercion
		const row = sessions.get(Number(params[0]));
		return { rows: row ? [toRow(row)] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where invite_token =')) {
		const row = [...sessions.values()].find((s) => s.invite_token === params[0]);
		return { rows: row ? [toRow(row)] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where candidate_id =')) {
		const rows = [...sessions.values()].filter((s) => Number(s.candidate_id) === Number(params[0]));
		return { rows: rows.map(toRow), rowCount: rows.length };
	}
	if (normalized.includes('from interview_sessions where job_id =')) {
		const rows = [...sessions.values()].filter((s) => Number(s.job_id) === Number(params[0]));
		return { rows: rows.map(toRow), rowCount: rows.length };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
		const id = Number(params[params.length - 1]);
		const row = sessions.get(id);
		if (!row) return { rows: [], rowCount: 0 };
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
			const nowMatch = trimmed.match(/^(\w+)\s*=\s*now\(\)$/);
			if (nowMatch) row[nowMatch[1]] = new Date().toISOString();
		}
		return { rows: [toRow(row)], rowCount: 1 };
	}
	throw new Error(`unhandled interview_sessions SQL in test mock: ${normalized}`);
}

db.query.mockImplementation(async (sql, params) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (normalized.includes('interview_sessions')) {
		return handleSessionSql(normalized, params || []);
	}
	if (normalized.includes('scheduled_interviews')) {
		const rows = scheduledInterviews.filter(
			(r) => Number(r.candidate_id) === Number((params || [])[0]),
		);
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('interview_events')) {
		const rows = interviewEvents.filter(
			(r) => Number(r.candidate_id) === Number((params || [])[0]),
		);
		return { rows, rowCount: rows.length };
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
const RECRUiter = { id: 2, email: 'rec@test.com', role: 'recruiter' };

function screeningConfig() {
	return {
		question_source: 'template',
		job: { title: 'Backend Engineer', description: 'Node.js APIs', company_name: 'Acme' },
		template: { topics: ['experience', 'logistics'], questions: [] },
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

beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	scheduledInterviews.length = 0;
	interviewEvents.length = 0;
	global.__testUsers = { 1: CANDIDATE, 2: RECRUiter };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockTranscribeAudio.mockReset();
	mockTextToSpeech.mockReset();
	mockTextToSpeech.mockResolvedValue(Buffer.from('fake-mp3-bytes'));
	engineSeenLengths.length = 0;
	mockConductTurn.mockImplementation(async (sess) => {
		// Snapshot the conversation length at call time (the router keeps
		// mutating the array afterwards, so the recorded arg can't be trusted).
		engineSeenLengths.push(sess.conversation.length);
		return {
			ai_message: 'Thanks for that. Tell me about a challenging project.',
			phase: 'background',
			is_complete: false,
		};
	});
	mockGenerateReport.mockResolvedValue({
		overall_score: 82,
		recommendation: 'advance',
		recommendation_reasoning: 'Strong backend depth.',
		strengths: ['concrete examples'],
		red_flags: [],
		dimension_scores: {},
		key_moments: [],
		question_scores: [],
	});
});

describe('POST /api/interviews/interview-sessions', () => {
	it('creates a screening session with frozen engine config', async () => {
		const app = buildApp();
		const res = await createSession(app);

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.session).toMatchObject({
			type: 'screening',
			status: 'invited',
			candidate_id: 1,
		});
		expect(res.body.session.invite_token).toBeTruthy();
		// Task 2 reviewer requirement: creator writes question_source + engine keys
		expect(res.body.session.config.question_source).toBe('template');
		expect(res.body.session.config.job.title).toBe('Backend Engineer');
		expect(res.body.session.config.current_phase).toBe('intro');
	});

	it('defaults question_source to personalized for ai_interview type', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.send({
				type: 'ai_interview',
				candidate_id: 1,
				config: { target_role: 'Data Engineer', base_questions: [{ question_text: 'Q1' }] },
			});

		expect(res.status).toBe(201);
		expect(res.body.session.config.question_source).toBe('personalized');
		expect(res.body.session.config.current_question_index).toBe(0);
	});

	it('rejects unknown session types', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.send({ type: 'nope', candidate_id: 1, config: {} });

		expect(res.status).toBe(400);
	});

	it('requires authentication', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.send({ type: 'screening', candidate_id: 1, config: {} });

		expect(res.status).toBe(401);
	});
});

describe('session lifecycle: create → start → respond → complete', () => {
	it('grows the conversation per turn and returns a final report', async () => {
		const app = buildApp();

		const created = await createSession(app);
		const id = created.body.session.id;
		expect(created.body.session.conversation).toEqual([]);

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1')
			.send();
		expect(started.status).toBe(200);
		expect(started.body.success).toBe(true);
		expect(started.body.ai_message).toBeTruthy();
		expect(started.body.session.status).toBe('in_progress');
		expect(started.body.session.conversation).toHaveLength(1);
		expect(started.body.session.conversation[0].role).toBe('interviewer');
		// intro turn went through the engine with empty candidate text
		expect(mockConductTurn).toHaveBeenCalledTimes(1);
		expect(mockConductTurn.mock.calls[0][1]).toBe('');

		const responded = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'I have five years of backend experience with Node.js.' });
		expect(responded.status).toBe(200);
		expect(responded.body.ai_message).toBeTruthy();
		expect(responded.body.is_complete).toBe(false);
		expect(responded.body.session.conversation).toHaveLength(3);
		expect(responded.body.session.conversation[1]).toMatchObject({ role: 'candidate' });
		expect(responded.body.session.conversation[2]).toMatchObject({ role: 'interviewer' });
		// engine received the candidate text and the persisted conversation
		expect(mockConductTurn.mock.calls[1][1]).toBe(
			'I have five years of backend experience with Node.js.',
		);
		expect(engineSeenLengths[1]).toBe(2);

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/complete`)
			.set('x-test-user-id', '1')
			.send();
		expect(completed.status).toBe(200);
		expect(completed.body.success).toBe(true);
		expect(completed.body.session.status).toBe('completed');
		expect(mockGenerateReport).toHaveBeenCalledTimes(1);
		expect(completed.body.report).toMatchObject({
			overall_score: 82,
			recommendation: 'advance',
		});
		// report persisted on the session config
		expect(completed.body.session.config.report.overall_score).toBe(82);
	});

	it('double-start with the same session returns the existing session (idempotent)', async () => {
		const app = buildApp();
		const created = await createSession(app, { invite_token: 'tok-abc-123' });
		const id = created.body.session.id;

		const first = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1')
			.send();
		const second = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1')
			.send();

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(second.body.session.id).toBe(id);
		expect(second.body.already_started).toBe(true);
		// intro turn generated exactly once — no duplicated interviewer turn
		expect(mockConductTurn).toHaveBeenCalledTimes(1);
		expect(second.body.session.conversation).toHaveLength(1);
	});

	it('rejects respond on a session that has not started', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'hello there' });

		expect(res.status).toBe(409);
	});

	it('rejects empty responses', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1');

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'x' });

		expect(res.status).toBe(400);
	});

	it("forbids starting another candidate's session", async () => {
		const app = buildApp();
		const created = await createSession(app); // candidate_id: 1
		const id = created.body.session.id;
		global.__testUsers[3] = { id: 3, email: 'other@test.com', role: 'candidate' };

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '3')
			.send();

		expect(res.status).toBe(403);
	});

	it('returns 404 for unknown session ids', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions/9999/start')
			.set('x-test-user-id', '1')
			.send();

		expect(res.status).toBe(404);
	});
});

describe('POST /api/interviews/interview-sessions/:id/respond with audio', () => {
	it('transcribes the audio buffer and feeds the text to the engine', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1');

		mockTranscribeAudio.mockResolvedValue({ text: 'transcribed candidate answer' });

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.attach('audio', Buffer.from('fake-audio-bytes'), {
				filename: 'answer.webm',
				contentType: 'audio/webm',
			});

		expect(res.status).toBe(200);
		expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
		expect(mockConductTurn.mock.calls[1][1]).toBe('transcribed candidate answer');
		expect(res.body.session.conversation[1]).toMatchObject({
			role: 'candidate',
			text: 'transcribed candidate answer',
			has_audio: true,
		});
	});
});

describe('GET /api/interviews/interview-sessions', () => {
	it('lists unified sessions and read-links human-scheduled interviews', async () => {
		const app = buildApp();
		await createSession(app);
		await createSession(app, { type: 'practice' });
		scheduledInterviews.push({
			id: 77,
			type: 'human_scheduled',
			source: 'scheduled_interviews',
			status: 'scheduled',
			job_id: 10,
			candidate_id: 1,
			company_id: 5,
			scheduled_at: new Date().toISOString(),
		});
		interviewEvents.push({
			id: 88,
			type: 'human_scheduled',
			source: 'interview_events',
			status: 'confirmed',
			job_id: 10,
			candidate_id: 1,
			company_id: 5,
			scheduled_at: new Date().toISOString(),
		});

		const res = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.query({ candidate_id: 1 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.sessions).toHaveLength(4);
		const bySource = Object.fromEntries(res.body.sessions.map((s) => [s.source, s]));
		expect(bySource.interview_session).toBeDefined();
		expect(bySource.scheduled_interviews.type).toBe('human_scheduled');
		expect(bySource.interview_events.type).toBe('human_scheduled');
	});

	it('lets recruiters list by job_id', async () => {
		const app = buildApp();
		await createSession(app);

		const res = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.query({ job_id: 10 });

		expect(res.status).toBe(200);
		expect(res.body.sessions).toHaveLength(1);
	});

	it('requires a filter', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1');

		expect(res.status).toBe(400);
	});
});

describe('POST /api/interviews/interview-sessions/:id/tts', () => {
	it('returns synthesized audio', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/tts`)
			.set('x-test-user-id', '1')
			.send({ text: 'Hello, welcome to your interview.' });

		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
		expect(mockTextToSpeech).toHaveBeenCalledTimes(1);
		expect(mockTextToSpeech.mock.calls[0][0]).toBe('Hello, welcome to your interview.');
	});

	it('falls back gracefully when TTS is unavailable', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		mockTextToSpeech.mockResolvedValue(null);

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/tts`)
			.set('x-test-user-id', '1')
			.send({ text: 'Hello.' });

		expect(res.status).toBe(200);
		expect(res.body.tts_unavailable).toBe(true);
	});
});
