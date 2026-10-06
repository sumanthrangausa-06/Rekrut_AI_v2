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

// ─── LiveKit EgressClient boundary (Task 6) ─────────────────────────────────
// The session-complete hook stops the session's room egress via the real
// service; only the EgressClient constructor is stubbed (no network).
const mockEgressClient = {
	startRoomCompositeEgress: jest.fn(),
	stopEgress: jest.fn(async (egressId) => ({ egressId, status: 'EGRESS_COMPLETE' })),
	listEgress: jest.fn(async () => []),
};
jest.mock('livekit-server-sdk', () => {
	const actual = jest.requireActual('livekit-server-sdk');
	return { ...actual, EgressClient: jest.fn(() => mockEgressClient) };
});

// Hermetic LiveKit config for the egress tests (values never leave the process).
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

const mockNotifyUser = jest.fn();
jest.mock('../../../lib/notify', () => ({
	notifyUser: (...args) => mockNotifyUser(...args),
}));

// ─── In-memory interview-domain store (extends the global mocked lib/db) ────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
let nextSessionId = 1;
const scheduledInterviews = [];
const interviewEvents = [];
// Session-linked recordings (Task 9): interview_session_id -> recording row.
const sessionRecordings = new Map();
// Trigger fixtures (Task 6): jobs, applications, resumes, question bank.
const jobs = new Map();
const applications = new Map();
const resumes = new Map(); // user_id -> latest parsed_resumes row
const questionBank = [];
// Conversation lengths seen by the (mocked) engine at call time, per test.
const engineSeenLengths = [];
// Ordered DB/engine events for the crash-resume test: 'update' (each UPDATE
// interview_sessions, with its SQL + params) vs 'engine' (conductTurn call).
const dbCallOrder = [];
const recordedUpdates = [];

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
	if (normalized.includes('from interview_sessions where application_id =')) {
		const rows = [...sessions.values()].filter(
			(s) => Number(s.application_id) === Number(params[0]),
		);
		return { rows: rows.map(toRow), rowCount: rows.length };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
		const id = Number(params[params.length - 1]);
		const row = sessions.get(id);
		if (!row) return { rows: [], rowCount: 0 };
		dbCallOrder.push('update');
		recordedUpdates.push({ normalized, params: [...(params || [])] });
		for (const assignment of setPart.split(',')) {
			const trimmed = assignment.trim();
			// M1 (#323): jsonb merge — `config = config || $N::jsonb` merges
			// top-level keys, mirroring real Postgres semantics.
			const mergeMatch = trimmed.match(/^(\w+)\s*=\s*\1\s*\|\|\s*\$(\d+)(::\w+)?$/);
			if (mergeMatch) {
				const delta = maybeParse(params[Number(mergeMatch[2]) - 1]) || {};
				row[mergeMatch[1]] = { ...(row[mergeMatch[1]] || {}), ...delta };
				continue;
			}
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
		// The candidate branch filters by candidate_id; the recruiter job_id
		// branch filters by job_id.
		const key = normalized.includes('where job_id') ? 'job_id' : 'candidate_id';
		const rows = scheduledInterviews.filter((r) => Number(r[key]) === Number((params || [])[0]));
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('interview_events')) {
		// The candidate branch filters e.candidate_id; the recruiter job_id
		// branch filters ja.job_id through the job_applications JOIN (note:
		// the SELECT clause also names ja.job_id — match the WHERE clause).
		const key = normalized.includes('where ja.job_id') ? 'job_id' : 'candidate_id';
		const rows = interviewEvents.filter((r) => Number(r[key]) === Number((params || [])[0]));
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('from interview_recordings')) {
		// findRecordingBySessionId: WHERE interview_session_id = $1
		const row = sessionRecordings.get(Number((params || [])[0]));
		return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_recordings')) {
		// Task 6 finalize: status completed + retention COALESCE.
		// Router SQL: SET status='completed', stopped_at=NOW(), updated_at=NOW(),
		// retention_expires_at=COALESCE(retention_expires_at, $2) WHERE id=$1.
		const row = [...sessionRecordings.values()].find((r) => Number(r.id) === Number(params[0]));
		if (row) {
			row.status = 'completed';
			row.stopped_at = new Date().toISOString();
			row.updated_at = new Date().toISOString();
			if (!row.retention_expires_at && params[1]) {
				row.retention_expires_at = params[1] instanceof Date ? params[1].toISOString() : params[1];
			}
		}
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from jobs where id =')) {
		const row = jobs.get(Number((params || [])[0]));
		return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from job_applications where id =')) {
		const row = applications.get(Number((params || [])[0]));
		return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from parsed_resumes')) {
		const row = resumes.get(Number((params || [])[0]));
		return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from question_bank')) {
		const role = String((params || [])[0] || '').toLowerCase();
		const rows = questionBank.filter((q) => String(q.role).toLowerCase() === role).slice(0, 10);
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
const RECRUiter = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 5 };

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
	sessionRecordings.clear();
	jobs.clear();
	applications.clear();
	resumes.clear();
	questionBank.length = 0;
	mockNotifyUser.mockReset();
	global.__testUsers = { 1: CANDIDATE, 2: RECRUiter };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockTranscribeAudio.mockReset();
	mockTextToSpeech.mockReset();
	mockTextToSpeech.mockResolvedValue(Buffer.from('fake-mp3-bytes'));
	engineSeenLengths.length = 0;
	dbCallOrder.length = 0;
	recordedUpdates.length = 0;
	mockConductTurn.mockImplementation(async (sess) => {
		// Snapshot the conversation length at call time (the router keeps
		// mutating the array afterwards, so the recorded arg can't be trusted).
		engineSeenLengths.push(sess.conversation.length);
		dbCallOrder.push('engine');
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

	it('persists the candidate turn before the engine call (crash-resume safe)', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const id = created.body.session.id;
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1')
			.send();

		dbCallOrder.length = 0;
		recordedUpdates.length = 0;
		const text = 'My five years of backend experience.';
		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text });

		expect(res.status).toBe(200);
		// The candidate's answer hits the DB before the ≤20s LLM call runs:
		// a crash mid-turn can never lose it.
		expect(dbCallOrder).toEqual(['update', 'engine', 'update']);
		const preTurnConversation = JSON.parse(recordedUpdates[0].params[0]);
		expect(preTurnConversation).toHaveLength(2); // intro + candidate turn only
		expect(preTurnConversation[1]).toMatchObject({ role: 'candidate', text });
		// Post-turn write adds the interviewer turn.
		const postTurnConversation = JSON.parse(recordedUpdates[1].params[0]);
		expect(postTurnConversation).toHaveLength(3);
		expect(postTurnConversation[2]).toMatchObject({ role: 'interviewer' });
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

	it('forbids candidates from listing by job_id', async () => {
		const app = buildApp();
		await createSession(app);

		const res = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.query({ job_id: 10 });

		expect(res.status).toBe(403);
	});

	it('read-links human-scheduled interviews in the recruiter job_id view', async () => {
		const app = buildApp();
		await createSession(app); // job_id: 10
		scheduledInterviews.push({
			id: 77,
			status: 'scheduled',
			job_id: 10,
			candidate_id: 1,
			scheduled_at: new Date().toISOString(),
		});
		interviewEvents.push({
			id: 88,
			status: 'confirmed',
			job_id: 10,
			candidate_id: 1,
			job_application_id: 20,
			scheduled_at: new Date().toISOString(),
		});

		const res = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.query({ job_id: 10 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.sessions).toHaveLength(3);
		const bySource = Object.fromEntries(res.body.sessions.map((s) => [s.source, s]));
		expect(bySource.interview_session).toBeDefined();
		expect(bySource.scheduled_interviews.type).toBe('human_scheduled');
		expect(bySource.interview_events.type).toBe('human_scheduled');
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

describe('POST /api/interviews/interview-sessions/trigger', () => {
	// ─── Trigger fixtures (Task 6) ──────────────────────────────────────────
	function seedTriggerFixtures(overrides = {}) {
		jobs.set(10, {
			id: 10,
			title: 'Backend Engineer',
			description: 'Build Node.js APIs at scale.',
			company_id: 5,
			company_name: 'Acme',
			...(overrides.job || {}),
		});
		applications.set(20, {
			id: 20,
			candidate_id: 1,
			job_id: 10,
			company_id: 5,
			...(overrides.application || {}),
		});
		if (!overrides.skipResume) {
			resumes.set(1, {
				id: 7,
				user_id: 1,
				original_filename: 'resume.pdf',
				parsed_data: {
					headline: 'Senior Backend Engineer',
					bio: '8 years building data platforms.',
					years_experience: 8,
					skills: ['Node.js', 'PostgreSQL'],
					...(overrides.resumeParsed || {}),
				},
			});
		}
		questionBank.push(
			{
				id: 101,
				role: 'Backend Engineer',
				question_text: 'Explain the Node.js event loop.',
				question_type: 'technical',
				difficulty: 'medium',
				key_points: ['libuv', 'non-blocking I/O'],
			},
			{
				id: 102,
				role: 'Backend Engineer',
				question_text: 'Tell me about a production incident you handled.',
				question_type: 'behavioral',
				difficulty: 'medium',
				key_points: ['ownership', 'postmortem'],
			},
		);
	}

	beforeEach(() => {
		seedTriggerFixtures();
	});

	function trigger(app, userId, body) {
		return request(app)
			.post('/api/interviews/interview-sessions/trigger')
			.set('x-test-user-id', String(userId))
			.send(body || { application_id: 20 });
	}

	it('creates an invited ai_interview session with JD + resume frozen in config', async () => {
		const app = buildApp();
		const res = await trigger(app, 2);

		expect(res.status).toBe(201);
		const session = res.body.session;
		expect(session.type).toBe('ai_interview');
		expect(session.status).toBe('invited');
		expect(session.job_id).toBe(10);
		expect(session.application_id).toBe(20);
		expect(session.candidate_id).toBe(1);
		expect(session.company_id).toBe(5);
		expect(session.triggered_by).toBe(2);
		expect(session.invite_token).toMatch(/^[a-f0-9]{64}$/);

		const config = session.config;
		expect(config.question_source).toBe('personalized');
		expect(config.job.title).toBe('Backend Engineer');
		expect(config.job.description).toBe('Build Node.js APIs at scale.');
		expect(config.resume.text).toMatch(/Senior Backend Engineer/);
		expect(config.resume.text).toMatch(/Node\.js/);
		expect(config.target_role).toBe('Backend Engineer');
		expect(config.current_question_index).toBe(0);
		expect(config.base_questions).toHaveLength(2);
		expect(config.base_questions[0].question_text).toBe('Explain the Node.js event loop.');

		expect(mockNotifyUser).toHaveBeenCalledTimes(1);
		const [userId, type, , , metadata] = mockNotifyUser.mock.calls[0];
		expect(userId).toBe(1);
		expect(type).toBe('ai_interview_invited');
		expect(metadata.invite_token).toBe(session.invite_token);
		expect(metadata.session_id).toBe(session.id);
	});

	it('works without a resume on file (JD-grounded only)', async () => {
		resumes.clear();
		const app = buildApp();
		const res = await trigger(app, 2);

		expect(res.status).toBe(201);
		expect(res.body.session.config.question_source).toBe('personalized');
		expect(res.body.session.config.resume).toBeNull();
		expect(res.body.session.config.job.description).toBe('Build Node.js APIs at scale.');
	});

	it('returns the existing session when triggered twice for the same application', async () => {
		const app = buildApp();
		const first = await trigger(app, 2);
		const second = await trigger(app, 2);

		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect(second.body.session.id).toBe(first.body.session.id);
		expect(second.body.already_triggered).toBe(true);
		// Notification fires once — the re-trigger is a no-op lookup.
		expect(mockNotifyUser).toHaveBeenCalledTimes(1);
	});

	it('rejects recruiters who do not own the job company', async () => {
		global.__testUsers[3] = { id: 3, email: 'other@test.com', role: 'recruiter', company_id: 9 };
		const app = buildApp();
		const res = await trigger(app, 3);

		expect(res.status).toBe(403);
		expect(mockNotifyUser).not.toHaveBeenCalled();
	});

	it('rejects candidates', async () => {
		const app = buildApp();
		const res = await trigger(app, 1);

		expect(res.status).toBe(403);
	});

	it('404s on missing application', async () => {
		const app = buildApp();
		const res = await trigger(app, 2, { application_id: 999 });

		expect(res.status).toBe(404);
	});

	it('400s without an application_id', async () => {
		const app = buildApp();
		const res = await trigger(app, 2, {});

		expect(res.status).toBe(400);
	});
});

describe('GET /api/interviews/interview-sessions/by-token/:token (Task 8)', () => {
	it('resolves a session by invite token without auth', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const token = created.body.session.invite_token;
		expect(token).toMatch(/^[a-f0-9]{64}$/);

		// No x-test-user-id header — the join link must work pre-login.
		const res = await request(app).get(`/api/interviews/interview-sessions/by-token/${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.session.id).toBe(created.body.session.id);
		expect(res.body.session.type).toBe('screening');
		// Redacted shape: no conversation, no full config for anonymous callers.
		expect(res.body.session.conversation).toBeUndefined();
		expect(res.body.session.job.title).toBeDefined();
	});

	it('404s on an unknown token', async () => {
		const app = buildApp();
		const res = await request(app).get(
			'/api/interviews/interview-sessions/by-token/does-not-exist',
		);

		expect(res.status).toBe(404);
	});
});

describe('GET /api/interviews/interview-sessions/:id/recording (Task 9)', () => {
	function seedRecording(sessionId) {
		const row = {
			id: 900 + sessionId,
			interview_session_id: sessionId,
			status: 'completed',
			started_at: new Date().toISOString(),
			stopped_at: new Date().toISOString(),
			duration_seconds: 372,
			file_size_bytes: 1024,
			file_format: 'webm',
			retention_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
		};
		sessionRecordings.set(sessionId, row);
		return row;
	}

	it('returns the linked recording for the session', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const sessionId = created.body.session.id;
		const rec = seedRecording(sessionId);

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${sessionId}/recording`)
			.set('x-test-user-id', '2'); // recruiter

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.recording).toMatchObject({ id: rec.id, status: 'completed' });
		// Task 12: the endpoint must expose the retention expiry so retention
		// can be verified without DB access.
		expect(res.body.recording.retention_expires_at).toBe(rec.retention_expires_at);
	});

	it('returns null recording when the session has none', async () => {
		const app = buildApp();
		const created = await createSession(app);

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${created.body.session.id}/recording`)
			.set('x-test-user-id', '2');

		expect(res.status).toBe(200);
		expect(res.body.recording).toBeNull();
	});

	it('404s for an unknown session', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-sessions/99999/recording')
			.set('x-test-user-id', '2');

		expect(res.status).toBe(404);
	});

	it("403s when a candidate accesses another candidate's session", async () => {
		const app = buildApp();
		const created = await createSession(app); // candidate_id: 1
		global.__testUsers[3] = { id: 3, email: 'other@test.com', role: 'candidate' };

		const res = await request(app)
			.get(`/api/interviews/interview-sessions/${created.body.session.id}/recording`)
			.set('x-test-user-id', '3');

		expect(res.status).toBe(403);
	});
});

describe('human interview sessions (Track B observer target, #323)', () => {
	it('recruiter can create a human session', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.send({ type: 'human', candidate_id: 1, job_id: 10, application_id: 20 });

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.session).toMatchObject({
			type: 'human',
			status: 'invited',
			candidate_id: 1,
			company_id: 5,
		});
	});

	it('candidate cannot create a human session', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.send({ type: 'human', candidate_id: 1 });

		expect(res.status).toBe(403);
	});

	it('start skips the AI intro turn for human sessions (but still in_progress)', async () => {
		const app = buildApp();
		const created = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.send({ type: 'human', candidate_id: 1 });
		expect(created.status).toBe(201);
		const id = created.body.session.id;

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.session.status).toBe('in_progress');
		// No AI intro: the engine must not be asked to speak for a human interview.
		expect(mockConductTurn).not.toHaveBeenCalled();
		expect(res.body.session.conversation).toEqual([]);
	});

	it('respond is rejected for human sessions — humans talk, the AI does not', async () => {
		const app = buildApp();
		const created = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.send({ type: 'human', candidate_id: 1 });
		const id = created.body.session.id;
		await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1');

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'Hello?' });

		expect(res.status).toBe(400);
		expect(mockConductTurn).not.toHaveBeenCalled();
	});
});

describe('POST /api/interviews/interview-sessions/:id/complete — recording finalize (Task 6)', () => {
	function seedRecording(sessionId, overrides = {}) {
		const row = {
			id: 900 + sessionId,
			interview_event_id: null,
			room_id: null,
			interview_session_id: sessionId,
			livekit_egress_id: null,
			status: 'recording',
			started_at: new Date().toISOString(),
			stopped_at: null,
			retention_expires_at: null, // prove the finalize path sets it per policy
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			...overrides,
		};
		sessionRecordings.set(sessionId, row);
		return row;
	}

	beforeEach(() => {
		mockEgressClient.stopEgress.mockClear();
	});

	it('stops the room egress and finalizes the recording on complete', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const sessionId = created.body.session.id;
		seedRecording(sessionId, { livekit_egress_id: 'EG_1' });

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/complete`)
			.set('x-test-user-id', '1')
			.send();

		expect(completed.status).toBe(200);
		expect(completed.body.success).toBe(true);
		// Egress stopped...
		expect(mockEgressClient.stopEgress).toHaveBeenCalledTimes(1);
		expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('EG_1');
		// ...recording finalized, retention set per the Phase 1 (90-day) policy.
		const row = sessionRecordings.get(sessionId);
		expect(row.status).toBe('completed');
		expect(row.stopped_at).toBeTruthy();
		expect(row.retention_expires_at).toBeTruthy();
		const deltaDays =
			(new Date(row.retention_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
		expect(deltaDays).toBeGreaterThan(89);
		expect(deltaDays).toBeLessThan(91);
	});

	it('finalizes the recording even with an empty conversation (Track B human interview)', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const sessionId = created.body.session.id;
		seedRecording(sessionId, { livekit_egress_id: 'EG_2' });
		// No start/respond: conversation stays empty like a human interview.

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/complete`)
			.set('x-test-user-id', '1')
			.send();

		expect(completed.status).toBe(200);
		expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('EG_2');
		expect(sessionRecordings.get(sessionId).status).toBe('completed');
	});

	it('does not touch egress when the session recording has no egress id', async () => {
		const app = buildApp();
		const created = await createSession(app);
		const sessionId = created.body.session.id;
		seedRecording(sessionId, { livekit_egress_id: null });

		const completed = await request(app)
			.post(`/api/interviews/interview-sessions/${sessionId}/complete`)
			.set('x-test-user-id', '1')
			.send();

		expect(completed.status).toBe(200);
		expect(mockEgressClient.stopEgress).not.toHaveBeenCalled();
		expect(sessionRecordings.get(sessionId).status).toBe('completed');
	});
});
