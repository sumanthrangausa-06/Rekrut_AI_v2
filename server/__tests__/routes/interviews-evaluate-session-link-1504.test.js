/**
 * #1504 — POST /api/interviews/evaluate, screening_session_id branch:
 * the unified interview_sessions id must reach runMultiEvaluation.
 *
 * The route holds a LEGACY screening_sessions row. Migration 129 backfilled
 * those rows into interview_sessions WITHOUT preserving the legacy id, but
 * it copied invite_token, which is UNIQUE on both tables. The route resolves
 * screening_sessions.invite_token -> interview_sessions.id (scoped by
 * candidate_id) and passes it as context.interviewSessionId; no match means
 * NULL — never a fuzzy candidate/job/status match (STOP 1 on #1504).
 *
 * Mocking pattern mirrors interviews-evaluate-all-fail-1505.test.js: only
 * the DB and the AI evaluation boundary are mocked; the real route runs.
 * Regression pin only — NOT the HL-003 E2E gate (Quinn; see PR body, #1508).
 */
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 99, email: 'recruiter@test.com', role: 'recruiter', company_id: 5 };
		return next();
	});
	const actual = jest.requireActual('../../../lib/auth');
	return { ...actual, authMiddleware };
});
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { ai: passthrough, standard: passthrough, public: passthrough },
		createRateLimit: jest.fn(() => passthrough),
	};
});
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	generateInterviewQuestions: jest.fn(),
	analyzeInterviewResponse: jest.fn(),
	generateOverallFeedback: jest.fn(),
	analyzeVideoInterviewResponse: jest.fn(),
	handleAIError: jest.fn(),
}));
jest.mock('../../../services/conversation-engine', () => ({ conductTurn: jest.fn() }));
jest.mock('../../../services/omniscore', () => ({}));
jest.mock('../../../lib/transcription', () => ({
	filterWhisperHallucination: jest.fn(() => ({ isHallucination: false })),
	isValidTranscriptLength: jest.fn(() => true),
}));
jest.mock('../../../server/middleware/requireBiometricConsent', () => ({
	requireBiometricConsent: jest.fn(() => jest.fn((_req, _res, next) => next())),
}));
jest.mock('../../../lib/email-service', () => ({}));
jest.mock('../../../server/services/calendar-service', () => ({}));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn() }));
jest.mock('../../../routes/audit', () => ({ insertAuditLog: jest.fn(async () => ({})) }));
jest.mock('../../../lib/r2RecordingStore', () => ({
	uploadEncryptedRecording: jest.fn(),
	decryptRecording: jest.fn(),
}));

const mockRunMultiEvaluation = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	suggestSlots: jest.fn(),
	createReminders: jest.fn(),
	suggestRescheduleSlots: jest.fn(),
	generateScreeningQuestions: jest.fn(),
	generateScreeningTopics: jest.fn(),
	generateScreeningReport: jest.fn(),
	conductScreeningTurn: jest.fn(),
	SCREENING_PHASES: [],
	runMultiEvaluation: (...args) => mockRunMultiEvaluation(...args),
	checkStalledScreenings: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const db = require('../../../lib/db');
const interviewsRouter = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRouter);
	return app;
}

const SCREENING_ROW = {
	id: 42,
	candidate_id: 7,
	job_id: 11,
	company_id: 5,
	invite_token: 'tok-abc',
	conversation: [{ role: 'candidate', text: 'answer' }],
	responses: [],
	job_title: 'Data Analyst',
	job_description: 'Analyse product data and build dashboards.',
};

function mockDb({ unifiedId }) {
	db.query.mockImplementation(async (sql) => {
		const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (normalized.includes('from screening_sessions')) {
			return { rows: [SCREENING_ROW], rowCount: 1 };
		}
		if (normalized.includes('from interview_sessions')) {
			return unifiedId
				? { rows: [{ id: unifiedId }], rowCount: 1 }
				: { rows: [], rowCount: 0 };
		}
		return { rows: [], rowCount: 0 };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockRunMultiEvaluation.mockReset();
	mockRunMultiEvaluation.mockResolvedValue({ evaluations: {}, composite: null });
	jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /evaluate screening branch — session link (#1504)', () => {
	test('resolves the unified session via invite_token and passes interviewSessionId', async () => {
		mockDb({ unifiedId: 900 });

		const res = await request(makeApp())
			.post('/api/interviews/evaluate')
			.send({ screening_session_id: 42 });

		expect(res.status).toBe(200);
		expect(mockRunMultiEvaluation).toHaveBeenCalledTimes(1);
		const ctx = mockRunMultiEvaluation.mock.calls[0][3];
		expect(ctx.screeningSessionId).toBe(42);
		expect(ctx.interviewSessionId).toBe(900);
	});

	// Non-blocking note on PR #1509 review: pin the resolver's
	// candidate scoping — the interview_sessions lookup must be
	// parameterised with [invite_token, candidate_id], not token alone.
	test('resolver query is candidate-scoped: params are [invite_token, candidate_id]', async () => {
		mockDb({ unifiedId: 900 });

		const res = await request(makeApp())
			.post('/api/interviews/evaluate')
			.send({ screening_session_id: 42 });

		expect(res.status).toBe(200);
		const resolverCalls = db.query.mock.calls.filter(([sql]) =>
			sql.replace(/\s+/g, ' ').trim().toLowerCase().includes('from interview_sessions'),
		);
		expect(resolverCalls).toHaveLength(1);
		const [sql, params] = resolverCalls[0];
		expect(sql).toMatch(/candidate_id/);
		expect(params).toEqual([SCREENING_ROW.invite_token, SCREENING_ROW.candidate_id]);
	});

	test('unmatched token: interviewSessionId is NULL, never a guessed id', async () => {
		mockDb({ unifiedId: null });

		const res = await request(makeApp())
			.post('/api/interviews/evaluate')
			.send({ screening_session_id: 42 });

		expect(res.status).toBe(200);
		const ctx = mockRunMultiEvaluation.mock.calls[0][3];
		expect(ctx.interviewSessionId).toBeNull();
	});
});
