/**
 * Full-branch review C3 + I1 (#322): company-scoped session authorization.
 *
 * C3: canAccess() let ANY recruiter read/write ANY company's sessions
 * (transcripts, AI reports, resume text in configs) — sequential integer IDs
 * make enumeration trivial. The branch's own canManageFlow() is
 * company-scoped; session endpoints must match that standard.
 *
 * I1: spec §2 locks hiring-team visibility to recruiter + hiring manager, but
 * a hiring_manager who can trigger an AI interview got 403 on every session
 * endpoint.
 *
 * Desired behavior:
 * - canAccess: candidate themself → allow; admin → allow; recruiter /
 *   hiring_manager → allow only when user.company_id === session.company_id
 *   (fail-closed on missing company_id).
 * - List: non-admin, non-candidate callers only see their company's rows
 *   (unified + scheduled_interviews via company_id; interview_events via
 *   job_applications.company_id).
 * - POST /interview-sessions: a hiring-side caller cannot set a company_id
 *   that isn't their own (rejected); absent → derived from the caller.
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

const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
	selectQuestionSource: jest.fn(),
	TURN_TIMEOUT_MS: 20000,
}));
const mockGenerateReport = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
}));
jest.mock('../../../server/services/livekit', () => ({
	findRecordingBySessionId: jest.fn().mockResolvedValue(null),
	createRecordingRecord: jest.fn().mockResolvedValue(null),
	hasActiveConsent: jest.fn().mockResolvedValue(true),
}));
const mockTextToSpeech = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	textToSpeech: (...args) => mockTextToSpeech(...args),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(undefined),
}));

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

// Faithful company filtering: applies `company_id = $2` when the SQL carries it.
function applyCompanyFilter(rows, normalized, params) {
	if (!normalized.includes('company_id = $2')) return rows;
	return rows.filter((r) => Number(r.company_id) === Number(params[1]));
}

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

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
	if (normalized.includes('from interview_sessions where id =')) {
		const row = sessions.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where candidate_id =')) {
		let rows = [...sessions.values()].filter((s) => Number(s.candidate_id) === Number(params[0]));
		rows = applyCompanyFilter(rows, normalized, params);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.includes('from interview_sessions where job_id =')) {
		let rows = [...sessions.values()].filter((s) => Number(s.job_id) === Number(params[0]));
		rows = applyCompanyFilter(rows, normalized, params);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.includes('from scheduled_interviews where')) {
		// No rows seeded in this suite; the SQL must simply be accepted.
		return { rows: [], rowCount: 0 };
	}
	if (normalized.includes('from interview_events e')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const row = sessions.get(Number(params[params.length - 1]));
		if (!row) return { rows: [], rowCount: 0 };
		const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
		for (const assignment of setPart.split(',')) {
			const m = assignment.trim().match(/^(\w+)\s*=\s*\$(\d+)$/);
			if (m) row[m[1]] = maybeParse(params[Number(m[2]) - 1]);
			else if (/^\w+\s*=\s*now\(\)$/.test(assignment.trim()))
				row[assignment.trim().split('=')[0].trim()] = new Date().toISOString();
			else {
				const lit = assignment.trim().match(/^(\w+)\s*=\s*'([^']*)'$/);
				if (lit) row[lit[1]] = lit[2];
			}
		}
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('insert into audit_logs')) {
		return { rows: [], rowCount: 1 };
	}
	throw new Error(`unexpected SQL in session-auth test mock: ${sql}`);
});

const interviewSessionRoutes = require('../../../routes/interview-sessions');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewSessionRoutes);
	return app;
}

// Company 5: candidate 1, recruiter 2, hiring_manager 4. Company 9: recruiter 3,
// hiring_manager 6. Admin 7.
const USERS = {
	1: { id: 1, email: 'cand@test.com', role: 'candidate' },
	2: { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 5 },
	3: { id: 3, email: 'other@test.com', role: 'recruiter', company_id: 9 },
	4: { id: 4, email: 'hm@test.com', role: 'hiring_manager', company_id: 5 },
	6: { id: 6, email: 'hm9@test.com', role: 'hiring_manager', company_id: 9 },
	7: { id: 7, email: 'admin@test.com', role: 'admin' },
};

function seedSession(overrides = {}) {
	const row = {
		id: nextSessionId++,
		type: 'screening',
		job_id: 10,
		application_id: 20,
		candidate_id: 1,
		company_id: 5,
		triggered_by: 2,
		invite_token: 'tok',
		status: 'invited',
		config: { question_source: 'template', current_phase: 'intro', job: {}, template: {} },
		conversation: [],
		created_at: new Date().toISOString(),
		...overrides,
	};
	sessions.set(row.id, row);
	return row;
}

beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	global.__testUsers = { ...USERS };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockTextToSpeech.mockReset();
	mockConductTurn.mockResolvedValue({ ai_message: 'Hello.', phase: 'intro', is_complete: false });
	mockGenerateReport.mockResolvedValue({ overall_score: 80, recommendation: 'advance' });
	mockTextToSpeech.mockResolvedValue(Buffer.from('mp3'));
});

describe('C3: cross-company session access is forbidden', () => {
	test('recruiter from another company gets 403 on start/respond/complete/tts/recording', async () => {
		const app = buildApp();
		const s = seedSession(); // company 5

		for (const [method, url, body] of [
			['post', `/api/interviews/interview-sessions/${s.id}/start`],
			['post', `/api/interviews/interview-sessions/${s.id}/respond`, { text: 'hi' }],
			['post', `/api/interviews/interview-sessions/${s.id}/complete`],
			['post', `/api/interviews/interview-sessions/${s.id}/tts`, { text: 'hi' }],
			['get', `/api/interviews/interview-sessions/${s.id}/recording`],
		]) {
			const res = await request(app)
				[method](url)
				.set('x-test-user-id', '3') // recruiter, company 9
				.send(body || {});
			expect(`${method} ${url}`).not.toBe(''); // label for failures
			expect(res.status).toBe(403);
		}
	});

	test('recruiter from another company sees no sessions in either list view', async () => {
		const app = buildApp();
		seedSession(); // company 5, candidate 1, job 10

		const byCandidate = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '3')
			.query({ candidate_id: 1 });
		expect(byCandidate.status).toBe(200);
		expect(byCandidate.body.sessions).toEqual([]);

		const byJob = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '3')
			.query({ job_id: 10 });
		expect(byJob.status).toBe(200);
		expect(byJob.body.sessions).toEqual([]);
	});

	test('same-company recruiter keeps full access (no regression)', async () => {
		const app = buildApp();
		const s = seedSession();

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${s.id}/start`)
			.set('x-test-user-id', '2');
		expect(started.status).toBe(200);

		const list = await request(app)
			.get('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.query({ candidate_id: 1 });
		expect(list.status).toBe(200);
		expect(list.body.sessions).toHaveLength(1);
	});

	test('admin bypasses company scoping', async () => {
		const app = buildApp();
		const s = seedSession();

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${s.id}/start`)
			.set('x-test-user-id', '7');
		expect(started.status).toBe(200);
	});
});

describe('I1: hiring_manager has hiring-team visibility', () => {
	test('same-company hiring_manager can start and read the session recording', async () => {
		const app = buildApp();
		const s = seedSession();

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${s.id}/start`)
			.set('x-test-user-id', '4'); // hiring_manager, company 5
		expect(started.status).toBe(200);

		const recording = await request(app)
			.get(`/api/interviews/interview-sessions/${s.id}/recording`)
			.set('x-test-user-id', '4');
		expect(recording.status).toBe(200);
	});

	test('cross-company hiring_manager gets 403', async () => {
		const app = buildApp();
		const s = seedSession();

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${s.id}/start`)
			.set('x-test-user-id', '6'); // hiring_manager, company 9
		expect(res.status).toBe(403);
	});
});

describe('C3: session creation is company-scoped', () => {
	test('recruiter cannot create a session for another company', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.send({ type: 'screening', candidate_id: 1, company_id: 9, config: {} });

		expect(res.status).toBe(403);
		expect(sessions.size).toBe(0);
	});

	test('recruiter creating without company_id gets their own company derived', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '2')
			.send({ type: 'screening', candidate_id: 1, config: {} });

		expect(res.status).toBe(201);
		expect(res.body.session.company_id).toBe(5);
	});
});
