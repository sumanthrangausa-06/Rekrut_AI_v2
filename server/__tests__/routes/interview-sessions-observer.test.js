/**
 * Task 5 (#323) — Track B observer endpoints (RED).
 *
 * POST /interview-sessions/:id/observer/enable — hiring-team-only toggle,
 *   consent-gated (403 CONSENT_REQUIRED without candidate consent, and the
 *   observer agent is never dispatched).
 * POST /interview-sessions/:id/observer/report — runs extractQAPairs +
 *   analyzeObserverSession over config.observer_transcript; 422 when there
 *   is no transcript.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
		return next();
	});
	return { authMiddleware };
});

// ─── External boundaries ─────────────────────────────────────────────────────
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: jest.fn(),
	selectQuestionSource: jest.fn(() => 'template'),
	TURN_TIMEOUT_MS: 20000,
}));
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: jest.fn(async () => ({ overall_score: 80, recommendation: 'advance' })),
	runMultiEvaluation: jest.fn(async () => ({})),
}));
jest.mock('../../../lib/ai-provider', () => ({ transcribeAudio: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({ textToSpeech: jest.fn() }));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn() }));
jest.mock('../../../routes/audit', () => ({ insertAuditLog: jest.fn(async () => ({})) }));

const mockFindRecordingBySessionId = jest.fn();
const mockHasActiveConsent = jest.fn();
const mockDispatchVoiceAgent = jest.fn();
jest.mock('../../services/livekit', () => ({
	findRecordingBySessionId: (...a) => mockFindRecordingBySessionId(...a),
	hasActiveConsent: (...a) => mockHasActiveConsent(...a),
	dispatchVoiceAgent: (...a) => mockDispatchVoiceAgent(...a),
}));

const mockExtractQAPairs = jest.fn();
const mockAnalyzeObserverSession = jest.fn();
jest.mock('../../../services/qa-extraction', () => ({
	extractQAPairs: (...a) => mockExtractQAPairs(...a),
	analyzeObserverSession: (...a) => mockAnalyzeObserverSession(...a),
}));

// ─── In-memory DB ────────────────────────────────────────────────────────────
const mockSessions = new Map();
function seedSession(overrides = {}) {
	const id = mockSessions.size + 1;
	const row = {
		id,
		type: 'ai_interview',
		job_id: 11,
		application_id: 21,
		candidate_id: 4,
		company_id: 2,
		status: 'in_progress',
		config: {},
		conversation: [],
		...overrides,
	};
	mockSessions.set(id, row);
	return row;
}

jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params = []) => {
		const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (n.startsWith('select * from interview_sessions where id =')) {
			const row = mockSessions.get(Number(params[0]));
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.startsWith('update interview_sessions set config =')) {
			const row = mockSessions.get(Number(params[1]));
			if (row) row.config = JSON.parse(params[0]);
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.includes('from interview_flows')) {
			return { rows: [{ rubric_weights: { can_do_the_work: 60, communication_quality: 40 } }] };
		}
		if (n.includes('from jobs where id =')) {
			return { rows: [{ title: 'Data Analyst', description: 'SQL dashboards' }] };
		}
		return { rows: [] };
	}),
}));

const router = require('../../../routes/interview-sessions');

const app = express();
app.use(express.json());
app.use(router);

global.__testUsers = {
	1: { id: 1, role: 'recruiter', company_id: 2, email: 'r@x.com' },
	4: { id: 4, role: 'candidate', company_id: null, email: 'c@x.com' },
	9: { id: 9, role: 'recruiter', company_id: 99, email: 'other@x.com' },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

beforeEach(() => {
	mockSessions.clear();
	mockFindRecordingBySessionId.mockReset();
	mockHasActiveConsent.mockReset();
	mockDispatchVoiceAgent.mockReset();
	mockExtractQAPairs.mockReset();
	mockAnalyzeObserverSession.mockReset();
	mockFindRecordingBySessionId.mockResolvedValue({ id: 55 });
	mockHasActiveConsent.mockResolvedValue(true);
	mockDispatchVoiceAgent.mockResolvedValue({ dispatched: true });
});

describe('POST /interview-sessions/:id/observer/enable', () => {
	test('hiring team with candidate consent enables the observer and dispatches the agent', async () => {
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.observer_enabled).toBe(true);
		expect(mockDispatchVoiceAgent).toHaveBeenCalledWith(s.id, 'observer');
		expect(mockSessions.get(s.id).config.observer_enabled).toBe(true);
	});

	test('no candidate consent → 403 CONSENT_REQUIRED and the agent is never dispatched', async () => {
		const s = seedSession();
		mockHasActiveConsent.mockResolvedValue(false);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
		expect(mockSessions.get(s.id).config.observer_enabled).not.toBe(true);
	});

	test('missing recording row → 403 consent required, no dispatch', async () => {
		const s = seedSession();
		mockFindRecordingBySessionId.mockResolvedValue(null);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('the candidate cannot enable the observer on their own session', async () => {
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(4));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('cross-company recruiter cannot enable the observer', async () => {
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(9));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('observer can be enabled on an invited session (before the candidate starts)', async () => {
		const s = seedSession({ status: 'invited' });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockDispatchVoiceAgent).toHaveBeenCalledWith(s.id, 'observer');
	});

	test('completed session → 409, no dispatch', async () => {
		const s = seedSession({ status: 'completed' });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(409);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('dispatch failure → 502 and the flag stays unset', async () => {
		const s = seedSession();
		mockDispatchVoiceAgent.mockRejectedValue(new Error('LiveKit down'));

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(502);
		expect(mockSessions.get(s.id).config.observer_enabled).not.toBe(true);
	});
});

describe('POST /interview-sessions/:id/observer/report', () => {
	test('runs extraction + analysis over the observer transcript and stores the report', async () => {
		const transcript = [{ speaker: 'recruiter-1', text: 'Tell me about yourself.', at: 'x' }];
		const s = seedSession({ config: { observer_transcript: transcript } });
		const pairs = [
			{
				question: 'Tell me about yourself.',
				answer: 'I am a data analyst.',
				asker: 'recruiter-1',
				answerer: 'candidate-4',
			},
		];
		mockExtractQAPairs.mockResolvedValue(pairs);
		mockAnalyzeObserverSession.mockResolvedValue({
			overall_score: 82,
			recommendation: 'advance',
			rubric_source: 'recruiter',
		});

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockExtractQAPairs).toHaveBeenCalledWith(transcript);
		expect(mockAnalyzeObserverSession).toHaveBeenCalledWith({
			session: expect.objectContaining({ id: s.id }),
			qaPairs: pairs,
			rubricWeights: { can_do_the_work: 60, communication_quality: 40 },
			job: { title: 'Data Analyst', description: 'SQL dashboards' },
		});
		expect(res.body.report.overall_score).toBe(82);
		expect(mockSessions.get(s.id).config.report.overall_score).toBe(82);
	});

	test('no observer transcript → 422', async () => {
		const s = seedSession({ config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(1));

		expect(res.status).toBe(422);
		expect(mockExtractQAPairs).not.toHaveBeenCalled();
	});

	test('cross-company recruiter cannot generate the report', async () => {
		const s = seedSession({ config: { observer_transcript: [{ speaker: 'a', text: 'b' }] } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(9));

		expect(res.status).toBe(403);
	});
});
