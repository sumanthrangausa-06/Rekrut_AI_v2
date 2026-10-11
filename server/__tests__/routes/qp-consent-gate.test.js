/**
 * QP biometric consent gate tests — S-066 (#719)
 *
 * AC-1: QP frame collection requires a biometric consent receipt before any
 *       frame is uploaded. No consent → no frames (403, gate at route level).
 * AC-2: Consent decline/withdrawal → 403 with respectful messaging; the
 *       frontend informs the user (no frames collected).
 *
 * Design (Option A, STOP 1): practice-session-bound receipts. QP creates a
 * lightweight interview_sessions row (type='practice') via SessionService;
 * consent receipts bind to it through the existing consent infrastructure.
 * The /practice/submit-video route is gated by requireBiometricConsent.
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = global.__TEST_USER__ || { id: 42, role: 'candidate', company_id: null };
		next();
	},
}));
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
	assertSessionOwnership: jest.fn(),
	recordConsent: jest.fn(),
}));
jest.mock('../../../lib/sessionService', () => ({
	create: jest.fn(),
}));
jest.mock('../../../lib/qp-ai', () => ({
	analyzeVideoInterviewResponse: jest.fn(),
}));

const consentService = require('../../../lib/consentService');
const SessionService = require('../../../lib/sessionService');
const qpAi = require('../../../lib/qp-ai');
const qpRouter = require('../../../routes/quick-practice');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', qpRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => {
		res.status(500).json({ error: 'Test error handler' });
	});
	return app;
}

const VALID_BODY = {
	question_id: 'beh-1',
	transcription: 'This is a sufficiently long transcription for the test to pass validation.',
	frames: ['base64framedata'],
	duration_seconds: 60,
};

describe('S-066: QP biometric consent gate', () => {
	let app;

	beforeEach(() => {
		jest.clearAllMocks();
		app = makeApp();
		global.__TEST_USER__ = { id: 42, role: 'candidate', company_id: null };
	});

	afterEach(() => {
		delete global.__TEST_USER__;
	});

	describe('POST /practice/session/start', () => {
		test('creates a practice-type session and returns the sessionId', async () => {
			SessionService.create.mockResolvedValue({ id: 9001, type: 'practice', status: 'invited' });

			const res = await request(app).post('/api/interviews/practice/session/start').send({});

			expect(res.status).toBe(201);
			expect(res.body.sessionId).toBe(9001);
			expect(SessionService.create).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'practice', candidateId: 42 })
			);
		});

		test('returns 500 when session creation fails (fail-closed)', async () => {
			SessionService.create.mockRejectedValue(new Error('DB down'));

			const res = await request(app).post('/api/interviews/practice/session/start').send({});

			expect(res.status).toBe(500);
			expect(res.body.sessionId).toBeUndefined();
		});
	});

	describe('POST /practice/submit-video consent gate (AC-1)', () => {
		test('blocks when sessionId is missing → 400 CONSENT_SESSION_REQUIRED', async () => {
			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send(VALID_BODY); // no sessionId

			expect(res.status).toBe(400);
			expect(res.body.code).toBe('CONSENT_SESSION_REQUIRED');
			expect(qpAi.analyzeVideoInterviewResponse).not.toHaveBeenCalled();
		});

		test('blocks when consent is missing → 403 CONSENT_REQUIRED, no frames uploaded', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'missing' });

			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('CONSENT_REQUIRED');
			// AC-1: no frames reach the analysis/upload path
			expect(qpAi.analyzeVideoInterviewResponse).not.toHaveBeenCalled();
		});

		test('blocks when consent was withdrawn → 403 CONSENT_WITHDRAWN (AC-2)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'withdrawn' });

			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('CONSENT_WITHDRAWN');
			expect(qpAi.analyzeVideoInterviewResponse).not.toHaveBeenCalled();
		});

		test('blocks when consent text is stale → 403 CONSENT_VERSION_STALE', async () => {
			consentService.checkConsentState.mockResolvedValue({
				state: 'stale',
				receiptVersion: 1,
				currentVersion: 2,
			});

			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('CONSENT_VERSION_STALE');
			expect(qpAi.analyzeVideoInterviewResponse).not.toHaveBeenCalled();
		});

		test('allows upload when consent is valid → proceeds to analysis', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
			qpAi.analyzeVideoInterviewResponse.mockResolvedValue({
				coaching: { overall_score: 7 },
			});

			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			// Gate passes; the route proceeds (may 200 or hit downstream logic, but NOT 403)
			expect(res.status).not.toBe(403);
			expect(qpAi.analyzeVideoInterviewResponse).toHaveBeenCalled();
		});

		test('consent check is scoped to the authenticated caller (IDOR protection)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'missing' });

			await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			// The middleware must pass the caller's ID, not a client-supplied one,
			// and must check the QP-specific consent type (C-1).
			expect(consentService.checkConsentState).toHaveBeenCalledWith(
				9001,
				'biometric_practice',
				42
			);
		});

		test('uses practice-surface messaging (non-punitive, correct nouns)', async () => {
			consentService.checkConsentState.mockResolvedValue({ state: 'withdrawn' });

			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send({ ...VALID_BODY, sessionId: 9001 });

			expect(res.status).toBe(403);
			expect(res.body.code).toBe('CONSENT_WITHDRAWN');
			// QP variant: no "is blocked" punitive framing, no "interview session" noun.
			expect(res.body.error).toMatch(/no problem/i);
			expect(res.body.error).not.toMatch(/blocked/i);
		});

		test('missing sessionId uses practice-surface message', async () => {
			const res = await request(app)
				.post('/api/interviews/practice/submit-video')
				.send(VALID_BODY);

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/practice session/i);
			expect(res.body.error).not.toMatch(/interview session/i);
		});
	});

	describe('re-consent UPSERT (H-1)', () => {
		// The UPSERT lives in consentService.recordConsent; these tests verify
		// the SQL handles decline → accept on the same session without a
		// UNIQUE violation. Mocked at the db.query level.
		test('documents the upsert contract: second recordConsent call updates in place', async () => {
			// This is a contract test — the real verification is the
			// ON CONFLICT clause in lib/consentService.js. We assert the
			// query text contains the upsert to lock the behavior.
			const fs = require('fs');
			const path = require('path');
			const src = fs.readFileSync(
				path.join(__dirname, '../../../lib/consentService.js'),
				'utf8'
			);
			expect(src).toMatch(/ON CONFLICT \(interview_session_id, consent_type, consent_text_version\)/);
			expect(src).toMatch(/DO UPDATE SET/);
		});
	});
});
