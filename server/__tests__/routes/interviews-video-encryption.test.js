/**
 * S-069 (#722): encrypted .webm recording upload + session-auth decrypt-proxy.
 *
 * AC-1: .webm recordings encrypted with the candidate's DEK before storage.
 * AC-2: playback requires authorization (session ownership) + server-side
 *       decryption — no plaintext at rest, no unauthenticated decrypt path.
 * AC-3: DEK destruction renders recordings unrecoverable (covered at the
 *       store layer in r2RecordingStore.test.js; the proxy surfaces it as 403).
 *
 * RED phase: routes/interviews.js does not encrypt uploads and has no
 * /video-playback route yet.
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
	// S-098 (#822): routes/interviews.js now also imports requireRole —
	// spread the actual module so the mock carries it.
	const actual = jest.requireActual('../../../lib/auth');
	return { ...actual, authMiddleware };
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
jest.mock('../../../lib/r2RecordingStore', () => ({
	uploadEncryptedRecording: jest.fn(),
	decryptRecording: jest.fn(),
}));
// Heavy route deps not under test
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	generateInterviewQuestions: jest.fn(),
	analyzeInterviewResponse: jest.fn(),
	generateOverallFeedback: jest.fn(),
	analyzeVideoInterviewResponse: jest.fn(),
	analyzeVideoPresentation: jest.fn(),
	analyzeVoiceQuality: jest.fn(),
	generateQuestionBank: jest.fn(),
	generateSessionFeedback: jest.fn(),
	textToSpeech: jest.fn(),
	transcribeAudioWithWhisper: jest.fn(),
	aiProvider: { transcribeAudio: jest.fn() },
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

const db = require('../../../lib/db');
const recordingStore = require('../../../lib/r2RecordingStore');
const interviewsRouter = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json());
	global.__testUsers = {
		42: { id: 42, email: 'candidate@test.com', role: 'candidate' },
		99: { id: 99, email: 'other@test.com', role: 'candidate' },
	};
	app.use('/api/interviews', interviewsRouter);
	return app;
}

// S-074 (#751): the 3 tests below were removed — POST /upload-video and
// POST /:id/respond now return 410 Gone (legacy write endpoints retired).
// Retirement behavior is covered in interviews-legacy-retirement.test.js.
// The video-playback decrypt-proxy tests below are unaffected (read path preserved).


describe('S-069 video-playback decrypt-proxy (AC-2)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	function interviewRow(overrides = {}) {
		return {
			id: 7,
			user_id: 42,
			responses: [
				{
					question_index: 0,
					video_url: '/api/interviews/video-playback/7/0',
					video_key: 'r2/interviews/1-abc-interview-7-q0.webm.enc',
				},
			],
			...overrides,
		};
	}

	test('owner gets decrypted video/webm with no-store (AC-2)', async () => {
		const app = makeApp();
		db.query.mockResolvedValueOnce({ rows: [interviewRow()] });
		recordingStore.decryptRecording.mockResolvedValueOnce(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

		const res = await request(app)
			.get('/api/interviews/video-playback/7/0')
			.set('x-test-user-id', '42');

		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toContain('video/webm');
		expect(res.headers['cache-control']).toBe('no-store');
		// Crypto H1: interviewId + questionIndex reconstruct the upload-time AAD
		expect(recordingStore.decryptRecording).toHaveBeenCalledWith(
			'r2/interviews/1-abc-interview-7-q0.webm.enc',
			42,
			7,
			0,
		);
	});

	test('non-owner gets 403 — no unauthenticated decrypt path (AC-2)', async () => {
		const app = makeApp();
		db.query.mockResolvedValueOnce({ rows: [interviewRow()] });

		const res = await request(app)
			.get('/api/interviews/video-playback/7/0')
			.set('x-test-user-id', '99');

		expect(res.status).toBe(403);
		expect(recordingStore.decryptRecording).not.toHaveBeenCalled();
	});

	test('unauthenticated request gets 401', async () => {
		const app = makeApp();

		const res = await request(app).get('/api/interviews/video-playback/7/0');

		expect(res.status).toBe(401);
		expect(recordingStore.decryptRecording).not.toHaveBeenCalled();
	});

	test('missing video_key → 404 (legacy plaintext rows keep their /api/files URLs)', async () => {
		const app = makeApp();
		db.query.mockResolvedValueOnce({ rows: [interviewRow({ responses: [{ question_index: 0 }] })] });

		const res = await request(app)
			.get('/api/interviews/video-playback/7/0')
			.set('x-test-user-id', '42');

		expect(res.status).toBe(404);
		expect(recordingStore.decryptRecording).not.toHaveBeenCalled();
	});

	test('decryption failure (destroyed DEK, tampered bytes) → 403, no oracle (AC-3)', async () => {
		const app = makeApp();
		db.query.mockResolvedValueOnce({ rows: [interviewRow()] });
		recordingStore.decryptRecording.mockRejectedValueOnce(
			Object.assign(new Error('DEK destroyed'), { code: 'DEK_DESTROYED' }),
		);

		const res = await request(app)
			.get('/api/interviews/video-playback/7/0')
			.set('x-test-user-id', '42');

		expect(res.status).toBe(403);
		expect(res.body.error).toBe('Recording access denied');
		// No oracle: the response must not reveal WHY decryption failed
		expect(JSON.stringify(res.body)).not.toMatch(/destroyed|DEK/i);
	});

	test('invalid params → 400', async () => {
		const app = makeApp();

		const res = await request(app)
			.get('/api/interviews/video-playback/abc/0')
			.set('x-test-user-id', '42');

		expect(res.status).toBe(400);
	});

	test('parseInt-lenient params rejected (crypto L1: "7abc" → 400, not interview 7)', async () => {
		const app = makeApp();

		const res = await request(app)
			.get('/api/interviews/video-playback/7abc/0')
			.set('x-test-user-id', '42');

		expect(res.status).toBe(400);
		expect(db.query).not.toHaveBeenCalled();
	});
});
