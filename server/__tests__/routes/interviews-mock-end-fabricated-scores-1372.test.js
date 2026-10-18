/**
 * #1372 — POST /mock/:sessionId/end must never persist a fabricated 5.
 *
 * Follow-up to #1364. When AI feedback fails or returns no overall_score,
 * the route used to mint a 5 at five points in this one flow: the
 * "basic feedback" object, the first persist (`overall_score || 5`),
 * the practice-history insert/update (`Math.round(... || 5)`), the
 * background recalc (`textScore = feedback.overall_score || 5`, blending
 * from the fabricated base), and the outer safety net (literal 5 in SQL).
 * Honest behaviour: overall_score persists as NULL, sub-scores are null,
 * the background blend only combines REAL scores (no text score ⇒ no
 * overall), and no practice_sessions row is minted for an unscored
 * session (practice_sessions.score is INTEGER NOT NULL, migration 007 —
 * a row would require inventing the number the schema demands).
 *
 * Only the DB and the AI lib (the input conditions) are mocked; the real
 * route logic runs. This does NOT satisfy the E2E-on-dev gate.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
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
jest.mock('../../../lib/r2RecordingStore', () => ({
	uploadEncryptedRecording: jest.fn(),
	decryptRecording: jest.fn(),
}));
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
const polsiaAi = require('../../../lib/polsia-ai');
const interviewsRouter = require('../../../routes/interviews');

function makeApp() {
	const app = express();
	app.use(express.json({ limit: '10mb' }));
	global.__testUsers = { 42: { id: 42, email: 'candidate@test.com', role: 'candidate' } };
	app.use('/api/interviews', interviewsRouter);
	return app;
}

const SESSION = {
	id: 7,
	user_id: 42,
	target_role: 'Engineer',
	status: 'in_progress',
	conversation: [
		{ role: 'interviewer', text: 'Tell me about yourself.' },
		{ role: 'candidate', text: 'I led a migration and delivered it early with results.' },
	],
	cached_feedback: null,
	question_ids: [],
	questions_asked: 1,
	follow_ups_asked: 0,
	current_question_index: 1,
	started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

function mockDb({ failFirstPersist = false } = {}) {
	let persistAttempts = 0;
	db.query.mockImplementation(async (sql) => {
		if (sql.includes('SELECT * FROM mock_interview_sessions')) {
			return { rows: [SESSION] };
		}
		if (sql.includes('UPDATE mock_interview_sessions') && failFirstPersist) {
			persistAttempts += 1;
			if (persistAttempts === 1) throw new Error('db write failed (test)');
		}
		return { rows: [] };
	});
}

function callsMatching(fragment) {
	return db.query.mock.calls.filter(([sql]) => sql.includes(fragment));
}

async function waitForCalls(fragment, count, timeoutMs = 3000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (callsMatching(fragment).length >= count) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`timed out waiting for ${count} calls matching: ${fragment}`);
}

describe('#1372 POST /mock/:sessionId/end — no fabricated scores', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	test('AI feedback throws: response + persisted overall_score are null (not 5), sub-scores null, no practice_sessions row minted', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockRejectedValue(new Error('all providers failed (test)'));

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.feedback.overall_score).toBeNull();
		expect(res.body.feedback.star_method_usage.score).toBeNull();
		expect(res.body.feedback.communication_quality.score).toBeNull();
		expect(res.body.feedback.technical_depth.score).toBeNull();

		const persists = callsMatching('UPDATE mock_interview_sessions');
		expect(persists.length).toBeGreaterThanOrEqual(1);
		expect(persists[0][1][0]).toBeNull();
		const persistedFeedback = JSON.parse(persists[0][1][1]);
		expect(persistedFeedback.overall_score).toBeNull();

		expect(callsMatching('INSERT INTO practice_sessions')).toHaveLength(0);
	});

	test('AI feedback returns no overall_score: persisted as null, no practice_sessions row', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockResolvedValue({
			summary: 'Feedback without a score.',
			strengths: [],
			improvements: [],
			question_scores: [],
		});

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({});

		expect(res.status).toBe(200);
		const persists = callsMatching('UPDATE mock_interview_sessions');
		expect(persists[0][1][0]).toBeNull();
		expect(callsMatching('INSERT INTO practice_sessions')).toHaveLength(0);
	});

	test('background recalc with NO text score: real presentation/voice sub-scores do not mint an overall — persisted overall stays null', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockResolvedValue({
			summary: 'Unscored feedback.',
			strengths: [],
			improvements: [],
			question_scores: [],
		});
		polsiaAi.analyzeVideoPresentation.mockResolvedValue({
			overall_presentation: 8,
			eye_contact: { score: 8, feedback: '' },
			facial_expressions: { score: 8, feedback: '' },
			body_language: { score: 8, feedback: '' },
			professional_appearance: { score: 8, feedback: '' },
			summary: 'seen',
		});
		polsiaAi.analyzeVoiceQuality.mockResolvedValue({ overall_voice_score: 8 });

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({ frames: ['data:image/jpeg;base64,/9j/4AAQ'] });

		expect(res.status).toBe(200);
		// Background enrichment issues a second UPDATE on the session.
		await waitForCalls('UPDATE mock_interview_sessions', 2);
		const bgPersist = callsMatching('UPDATE mock_interview_sessions')[1];
		expect(bgPersist[1][0]).toBeNull();
		const bgFeedback = JSON.parse(bgPersist[1][1]);
		expect(bgFeedback.overall_score).toBeNull();
		expect(bgFeedback.presentation.score).toBe(8);
		expect(callsMatching('practice_sessions')).toHaveLength(0);
	});

	test('string overall_score "7" (real LLM shape): persisted as numeric 7, practice row created with 7, background blends from 7 — never erased to null (specialist BLOCK fix)', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockResolvedValue({
			overall_score: '7',
			summary: 'Scored feedback.',
			strengths: [],
			improvements: [],
			question_scores: [],
		});
		polsiaAi.analyzeVoiceQuality.mockResolvedValue({ overall_voice_score: 8 });

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.feedback.overall_score).toBe(7);
		const persists = callsMatching('UPDATE mock_interview_sessions');
		expect(persists[0][1][0]).toBe(7);
		const inserts = callsMatching('INSERT INTO practice_sessions');
		expect(inserts).toHaveLength(1);
		expect(inserts[0][1][5]).toBe(7);

		// Background voice blend: (7*0.5 + 8*0.25) / 0.75 = 7.3 — from the
		// real 7, not null.
		await waitForCalls('UPDATE mock_interview_sessions', 2);
		const bgPersist = callsMatching('UPDATE mock_interview_sessions')[1];
		expect(bgPersist[1][0]).toBe(7.3);
	});

	test('positive control: text 6 + real presentation 8 blends to 6.7; text 6 with unscored video/voice stays 6', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockResolvedValue({
			overall_score: 6,
			summary: 'Scored feedback.',
			strengths: [],
			improvements: [],
			question_scores: [],
		});
		polsiaAi.analyzeVideoPresentation.mockResolvedValue({
			overall_presentation: 8,
			eye_contact: { score: 8, feedback: '' },
			facial_expressions: { score: 8, feedback: '' },
			body_language: { score: 8, feedback: '' },
			professional_appearance: { score: 8, feedback: '' },
			summary: 'seen',
		});
		polsiaAi.analyzeVoiceQuality.mockResolvedValue(null);

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({ frames: ['data:image/jpeg;base64,/9j/4AAQ'] });

		expect(res.status).toBe(200);
		await waitForCalls('UPDATE mock_interview_sessions', 2);
		expect(callsMatching('UPDATE mock_interview_sessions')[1][1][0]).toBe(6.7);
		const practiceUpdates = callsMatching('UPDATE practice_sessions');
		expect(practiceUpdates).toHaveLength(1);
		expect(practiceUpdates[0][1][1]).toBe(7);
	});

	test('positive control 2: text 6 with truthy-but-unscored video/voice results stays exactly 6', async () => {
		mockDb();
		polsiaAi.generateSessionFeedback.mockResolvedValue({
			overall_score: 6,
			summary: 'Scored feedback.',
			strengths: [],
			improvements: [],
			question_scores: [],
		});
		polsiaAi.analyzeVideoPresentation.mockResolvedValue({
			overall_presentation: null,
			eye_contact: { score: null, feedback: '' },
			facial_expressions: { score: null, feedback: '' },
			body_language: { score: null, feedback: '' },
			professional_appearance: { score: null, feedback: '' },
			summary: 'unavailable',
		});
		polsiaAi.analyzeVoiceQuality.mockResolvedValue({});

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({ frames: ['data:image/jpeg;base64,/9j/4AAQ'] });

		expect(res.status).toBe(200);
		await waitForCalls('UPDATE mock_interview_sessions', 2);
		expect(callsMatching('UPDATE mock_interview_sessions')[1][1][0]).toBe(6);
	});

	test('safety net: when the first persist fails, the completion fallback still persists null — never a literal 5', async () => {
		mockDb({ failFirstPersist: true });
		polsiaAi.generateSessionFeedback.mockRejectedValue(new Error('all providers failed (test)'));

		const res = await request(makeApp())
			.post('/api/interviews/mock/7/end')
			.set('x-test-user-id', '42')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.feedback.overall_score).toBeNull();
		expect(res.body.feedback.star_method_usage.score).toBeNull();
		const safety = callsMatching('UPDATE mock_interview_sessions').find(([sql]) =>
			sql.includes("status = 'completed'"),
		);
		expect(safety).toBeDefined();
		expect(safety[0]).not.toMatch(/overall_score\s*=\s*5/);
		expect(safety[1]).toContain(null);
	});
});
