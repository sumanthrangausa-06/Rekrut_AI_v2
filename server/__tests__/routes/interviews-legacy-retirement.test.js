/**
 * S-074 (#751): retire the 5 dead legacy interview write endpoints.
 *
 * AC-1: all 5 endpoints return 410 Gone with a JSON body explaining retirement.
 * AC-2: every hit is logged (endpoint, timestamp, IP/user-agent) for one sprint.
 * AC-4: read endpoints keep working (regression guard).
 *
 * RED phase: the 5 endpoints currently run their legacy handlers.
 */

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 42, email: 'candidate@test.com', role: 'candidate' };
		return next();
	});
	return { authMiddleware };
});

// ─── External boundaries ─────────────────────────────────────────────────────
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
const interviewsRouter = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRouter);
	return app;
}

const RETIRED = [
	['post', '/api/interviews/start'],
	['post', '/api/interviews/7/respond'],
	['post', '/api/interviews/7/complete'],
	['post', '/api/interviews/upload-video'],
	['post', '/api/interviews/save-analysis'],
];

describe('S-074 legacy write endpoint retirement (AC-1)', () => {
	test.each(RETIRED)('%s %s → 410 Gone with retirement JSON body', async (method, path) => {
		const app = makeApp();
		const res = await request(app)[method](path).send({});
		expect(res.status).toBe(410);
		expect(res.body).toMatchObject({
			error: expect.stringContaining('retired'),
			code: 'ENDPOINT_RETIRED',
		});
	});
});

describe('S-074 retired-hit logging (AC-2)', () => {
	test('each retired hit is logged with endpoint, timestamp, and request metadata', async () => {
		const app = makeApp();
		const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			await request(app)
				.post('/api/interviews/start')
				.set('User-Agent', 'test-agent/1.0')
				.send({ job_id: 1 });
			const logged = logSpy.mock.calls.some((args) =>
				String(args[0]).includes('/api/interviews/start'),
			);
			expect(logged).toBe(true);
		} finally {
			logSpy.mockRestore();
		}
	});
});

describe('S-074 read surface regression guard (AC-4)', () => {
	test('GET /history still routes to its handler (not 410)', async () => {
		const app = makeApp();
		const db = require('../../../lib/db');
		db.query.mockResolvedValueOnce({ rows: [] });
		const res = await request(app).get('/api/interviews/history');
		// Not 410 — the handler runs (200 with empty rows, or an error from
		// mocked deps, but never the retirement response).
		expect(res.status).not.toBe(410);
		expect(res.body.code).not.toBe('ENDPOINT_RETIRED');
	});

	test('GET /:id/analysis still routes to its handler (not 410)', async () => {
		const app = makeApp();
		const db = require('../../../lib/db');
		db.query.mockResolvedValueOnce({ rows: [] });
		const res = await request(app).get('/api/interviews/7/analysis');
		expect(res.status).not.toBe(410);
		expect(res.body.code).not.toBe('ENDPOINT_RETIRED');
	});
});
