/**
 * #1505 / PR #1506 Finding 6 — POST /api/interviews/evaluate, interview_id branch.
 *
 * runMultiEvaluation's all-fail contract is { evaluations: {}, composite: null }
 * (no successful lens => no composite, no fabricated score). The evaluate route
 * dereferenced result.composite.composite_score unconditionally, so the all-fail
 * state threw TypeError -> HTTP 500 "Failed to evaluate interview" instead of
 * returning 200 with composite:null and persisting ai_composite_score = NULL.
 *
 * Honest absence must never surface as a crash. Only the DB and the AI
 * evaluation boundary are mocked; the real route logic runs.
 * Regression pin only — NOT the HL-003 E2E-on-dev gate (Quinn's AFTER capture).
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

const INTERVIEW_ROW = {
	id: 123,
	candidate_id: 7,
	job_id: 11,
	company_id: 5,
	job_title: 'Data Analyst',
	job_description: 'Analyse product data and build dashboards.',
	feedback: null,
};

let updateCalls;
beforeEach(() => {
	jest.clearAllMocks();
	mockRunMultiEvaluation.mockReset();
	updateCalls = [];
	jest.spyOn(console, 'error').mockImplementation(() => {});
	db.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (normalized.includes('from scheduled_interviews')) {
			return { rows: [INTERVIEW_ROW], rowCount: 1 };
		}
		if (normalized.includes('from mock_interview_sessions')) {
			return { rows: [], rowCount: 0 };
		}
		if (normalized.startsWith('update scheduled_interviews')) {
			updateCalls.push(params);
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /evaluate — all-fail + interview_id (#1505 Finding 6)', () => {
	test('all lenses fail: returns 200 with composite:null and persists ai_composite_score=NULL, never 500', async () => {
		// The real all-fail return shape from runMultiEvaluation.
		mockRunMultiEvaluation.mockResolvedValue({ evaluations: {}, composite: null });

		const res = await request(makeApp())
			.post('/api/interviews/evaluate')
			.send({ interview_id: 123 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.composite).toBeNull();
		expect(res.body.evaluations).toEqual({});
		expect(updateCalls).toHaveLength(1);
		// $2 = ai_composite_score must be honest NULL, not a fabricated number.
		expect(updateCalls[0][1]).toBeNull();
		expect(updateCalls[0][2]).toBe(123);
		expect(JSON.parse(updateCalls[0][0]).composite).toBeNull();
	});

	test('control: composite present still persists its real composite_score', async () => {
		mockRunMultiEvaluation.mockResolvedValue({
			evaluations: { technical: { score: 71 } },
			composite: { composite_score: 71, technical_score: 71, culture_score: null, experience_score: null },
		});

		const res = await request(makeApp())
			.post('/api/interviews/evaluate')
			.send({ interview_id: 123 });

		expect(res.status).toBe(200);
		expect(res.body.composite.composite_score).toBe(71);
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0][1]).toBe(71);
	});
});
