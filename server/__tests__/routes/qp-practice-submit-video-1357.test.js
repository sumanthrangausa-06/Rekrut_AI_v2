/**
 * #1357 — Quick Practice submit-video must never fabricate scores.
 *
 * When analyzeVideoInterviewResponse returns null/invalid, the route used to
 * return HTTP 200 success:true with invented scores (overall_score 5 and
 * 5/10 content/communication/presentation sub-scores). That violates the
 * no-fake-scores rule: no analysis = a truthful, retryable error, and no
 * practice_sessions row for an analysis that never ran.
 *
 * The route's own catch block already has the truthful pattern (503 +
 * retryable:true on timeout / allProvidersFailed) — the null branch must
 * use the same shape.
 *
 * NOTE: only the AI provider return value is mocked (the input condition).
 * The route logic under test is real. These are regression pins; they do
 * NOT satisfy the Quinn E2E-on-dev gate.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null, stripe_subscription_id: null };
		next();
	},
}));
jest.mock('../../../lib/sessionService', () => ({ create: jest.fn() }));
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
	assertSessionOwnership: jest.fn(),
	recordConsent: jest.fn(),
}));
jest.mock('../../../server/middleware/requireBiometricConsent', () => ({
	requireBiometricConsent: () => (req, res, next) => next(),
}));
jest.mock('../../../lib/qp-ai', () => ({
	analyzeInterviewResponse: jest.fn(),
	generateInterviewCoaching: jest.fn(),
	analyzeVideoInterviewResponse: jest.fn(),
}));

const pool = require('../../../lib/db');
const qpAi = require('../../../lib/qp-ai');
const qpRouter = require('../../../routes/quick-practice');

function makeApp() {
	const app = express();
	app.use(express.json({ limit: '5mb' }));
	app.use('/api/interviews', qpRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => res.status(500).json({ error: 'Test error handler' }));
	return app;
}

const BODY = {
	question_id: 'beh-1',
	question: 'Tell me about a time when you had to deal with a difficult team member.',
	category: 'behavioral',
	transcription:
		'In my previous role I led a migration that was failing. I broke the work into small pieces and delivered early.',
	frames: ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'],
	duration_seconds: 60,
};

function inserts() {
	return pool.query.mock.calls.filter(([sql]) => /INSERT INTO practice_sessions/i.test(sql));
}

describe('#1357 POST /practice/submit-video — no fabricated scores', () => {
	let app;
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockResolvedValue({ rows: [] });
		app = makeApp();
	});

	test('analysis returns null → 503 retryable, no fabricated coaching, no session row', async () => {
		qpAi.analyzeVideoInterviewResponse.mockResolvedValue(null);

		const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

		expect(res.status).toBe(503);
		expect(res.body.success).not.toBe(true);
		expect(res.body.retryable).toBe(true);
		expect(res.body.retryAfterMs).toBe(3000);
		expect(res.body.error).toMatch(/try again/i);
		expect(res.body.coaching).toBeUndefined();
		expect(inserts()).toHaveLength(0);
	});

	test('analysis returns a non-object → 503 retryable, no session row', async () => {
		qpAi.analyzeVideoInterviewResponse.mockResolvedValue('not-an-analysis');

		const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

		expect(res.status).toBe(503);
		expect(res.body.retryable).toBe(true);
		expect(res.body.coaching).toBeUndefined();
		expect(inserts()).toHaveLength(0);
	});

	test('valid analysis → 200 success:true with the real coaching, session row written with its score', async () => {
		qpAi.analyzeVideoInterviewResponse.mockResolvedValue({
			overall_score: 8,
			content: { score: 8 },
			communication: { score: 7 },
			presentation: { score: 9 },
		});

		const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.coaching.overall_score).toBe(8);
		expect(inserts()).toHaveLength(1);
		// score is the 6th insert parameter ($6)
		expect(inserts()[0][1][5]).toBe(8);
	});

	test('analysis object without overall_score → 503 retryable, no session row (no blank "/10" verdict)', async () => {
		qpAi.analyzeVideoInterviewResponse.mockResolvedValue({
			content: { score: 7 },
			communication: { score: 7 },
			presentation: { score: 7 },
		});

		const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

		expect(res.status).toBe(503);
		expect(res.body.retryable).toBe(true);
		expect(res.body.coaching).toBeUndefined();
		expect(inserts()).toHaveLength(0);
	});

	test.each([[{}], [[]]])(
		'shapeless analysis object %p → 503 retryable, no session row',
		async (shapeless) => {
			qpAi.analyzeVideoInterviewResponse.mockResolvedValue(shapeless);

			const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

			expect(res.status).toBe(503);
			expect(res.body.retryable).toBe(true);
			expect(inserts()).toHaveLength(0);
		},
	);

	test('valid analysis with a real overall_score of 0 → stored as 0, not overwritten with 5', async () => {
		qpAi.analyzeVideoInterviewResponse.mockResolvedValue({
			overall_score: 0,
			content: { score: 0 },
			communication: { score: 0 },
			presentation: { score: 0 },
		});

		const res = await request(app).post('/api/interviews/practice/submit-video').send(BODY);

		expect(res.status).toBe(200);
		expect(inserts()).toHaveLength(1);
		expect(inserts()[0][1][5]).toBe(0);
	});
});
