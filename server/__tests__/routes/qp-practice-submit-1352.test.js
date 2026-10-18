/**
 * #1352 — Quick Practice text mode: 'Get AI Coaching' must never fail silently.
 *
 * Backend half: POST /practice/submit called analyzeInterviewResponse with no
 * try/catch and no fallback. When the AI provider layer throws (no provider /
 * all providers failed — the #1338 condition), the throw became a generic
 * 500 'Failed to analyze response'. The route must instead return a truthful,
 * retryable 503 and must NOT write a practice_sessions row for an analysis
 * that never happened.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null };
		next();
	},
}));
jest.mock('../../../lib/sessionService', () => ({ create: jest.fn() }));
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
	assertSessionOwnership: jest.fn(),
	recordConsent: jest.fn(),
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
	app.use(express.json());
	app.use('/api/interviews', qpRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => res.status(500).json({ error: 'Test error handler' }));
	return app;
}

const LONG_RESPONSE =
	'In my previous role I led a migration that was failing. I broke the work into small pieces, ' +
	'communicated daily with stakeholders, and delivered the project two weeks early.';

describe('#1352 POST /practice/submit — provider failure is truthful, never silent', () => {
	let app;
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockResolvedValue({ rows: [] });
		app = makeApp();
	});

	test('AI provider throws (allProvidersFailed) → 503 retryable, no session row written', async () => {
		const err = new Error('No available providers for llm. anthropic: not configured');
		err.allProvidersFailed = true;
		qpAi.analyzeInterviewResponse.mockRejectedValue(err);

		const res = await request(app)
			.post('/api/interviews/practice/submit')
			.send({ question_id: 'beh-1', response_text: LONG_RESPONSE });

		expect(res.status).toBe(503);
		expect(res.body.retryable).toBe(true);
		expect(res.body.error).toMatch(/temporarily unavailable/i);
		const inserts = pool.query.mock.calls.filter(([sql]) =>
			/INSERT INTO practice_sessions/i.test(sql),
		);
		expect(inserts).toHaveLength(0);
	});

	test('analysis throws a parse failure → 503 retryable (not a generic 500)', async () => {
		qpAi.analyzeInterviewResponse.mockRejectedValue(new Error('Failed to parse analysis'));

		const res = await request(app)
			.post('/api/interviews/practice/submit')
			.send({ question_id: 'beh-1', response_text: LONG_RESPONSE });

		expect(res.status).toBe(503);
		expect(res.body.retryable).toBe(true);
	});

	test('success path unchanged → 200 success:true with coaching, session row written', async () => {
		qpAi.analyzeInterviewResponse.mockResolvedValue({
			score: 7,
			strengths: ['Clear structure'],
			improvements: ['Add metrics'],
		});
		qpAi.generateInterviewCoaching.mockResolvedValue({
			improved_response: 'Better version',
			specific_tips: ['Quantify impact'],
		});

		const res = await request(app)
			.post('/api/interviews/practice/submit')
			.send({ question_id: 'beh-1', response_text: LONG_RESPONSE });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.coaching.score).toBe(7);
		const inserts = pool.query.mock.calls.filter(([sql]) =>
			/INSERT INTO practice_sessions/i.test(sql),
		);
		expect(inserts).toHaveLength(1);
	});
});
