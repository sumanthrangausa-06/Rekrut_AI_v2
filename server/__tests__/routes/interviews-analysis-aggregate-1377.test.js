/**
 * #1377 — GET /api/interviews/:id/analysis aggregate presentation score.
 *
 * The read path averaged rows with `parseFloat(row.presentation_score || 0)`:
 * a NULL presentation_score (the column is nullable, migration 010) was
 * averaged in as 0, and an interview whose rows are all NULL returned a
 * fabricated aggregate of 0. Honest behaviour: the aggregate averages
 * only rows carrying a real score, and is null when none do
 * ("insufficient data", Sumanth's no-fake-scores rule).
 *
 * Only the DB (the input condition) is mocked; the real route logic
 * runs. Regression pin only — NOT the E2E-on-dev gate.
 */
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 42, email: 'candidate@test.com', role: 'candidate' };
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

function seedAnalysis(analysisRows) {
	db.query
		.mockResolvedValueOnce({ rows: [{ id: 7, user_id: 42 }] })
		.mockResolvedValueOnce({ rows: analysisRows });
}

describe('#1377 GET /:id/analysis — aggregate presentation score', () => {
	beforeEach(() => jest.clearAllMocks());

	test('all-NULL presentation scores → aggregate is null, never 0', async () => {
		seedAnalysis([
			{ question_index: 0, presentation_score: null, analysis_data: {} },
			{ question_index: 1, presentation_score: null, analysis_data: {} },
		]);
		const res = await request(makeApp()).get('/api/interviews/7/analysis');
		expect(res.status).toBe(200);
		expect(res.body.aggregate_scores.presentation).toBeNull();
	});

	test('mixed NULL and real scores → average of real scores only', async () => {
		seedAnalysis([
			{ question_index: 0, presentation_score: null, analysis_data: {} },
			{ question_index: 1, presentation_score: '8.00', analysis_data: {} },
			{ question_index: 2, presentation_score: '6.00', analysis_data: {} },
		]);
		const res = await request(makeApp()).get('/api/interviews/7/analysis');
		expect(res.status).toBe(200);
		expect(res.body.aggregate_scores.presentation).toBe(7);
	});

	test('positive control: all real scores → plain average', async () => {
		seedAnalysis([
			{ question_index: 0, presentation_score: '9.00', analysis_data: {} },
			{ question_index: 1, presentation_score: '7.00', analysis_data: {} },
		]);
		const res = await request(makeApp()).get('/api/interviews/7/analysis');
		expect(res.status).toBe(200);
		expect(res.body.aggregate_scores.presentation).toBe(8);
	});
});
