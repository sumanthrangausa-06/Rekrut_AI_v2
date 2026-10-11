/**
 * S-070 (H-1) — biometric withdrawal terminates an active observer (RED).
 *
 * Continued biometric processing after consent withdrawal is a BIPA/GDPR
 * violation pattern. When a candidate withdraws biometric consent and the
 * AI observer is active on the session, the withdraw must tear it down:
 * disconnect the agent + flip observer_enabled to false.
 */
const request = require('supertest');
const express = require('express');

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 7, role: 'candidate', email: 'c@x.com' };
		return next();
	});
	return { authMiddleware };
});

const mockWithdrawConsent = jest.fn();
const mockAssertSessionOwnership = jest.fn(async () => {});
jest.mock('../../../lib/consentService', () => ({
	withdrawConsent: (...a) => mockWithdrawConsent(...a),
	assertSessionOwnership: (...a) => mockAssertSessionOwnership(...a),
	VALID_TYPES: ['recording', 'biometric', 'id_verification', 'biometric_practice'],
}));

const mockDisconnectVoiceAgent = jest.fn(async () => ({ removed_participant: true, deleted_dispatches: 1 }));
jest.mock('../../services/livekit', () => ({
	disconnectVoiceAgent: (...a) => mockDisconnectVoiceAgent(...a),
}));

// In-memory session store for the teardown's config check/update.
const mockSessions = new Map();
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params = []) => {
		const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (n.startsWith('select config from interview_sessions where id =')) {
			const row = mockSessions.get(Number(params[0]));
			return { rows: row ? [{ config: row.config }] : [] };
		}
		if (n.startsWith('update interview_sessions set config =')) {
			const row = mockSessions.get(Number(params[0]));
			if (row) row.config = { ...(row.config || {}), observer_enabled: false };
			return { rows: [] };
		}
		return { rows: [] };
	}),
}));

const router = require('../../../server/routes/consent');

const app = express();
app.use(express.json());
app.use('/api/consent', router);

beforeEach(() => {
	mockSessions.clear();
	mockWithdrawConsent.mockReset();
	mockAssertSessionOwnership.mockClear();
	mockDisconnectVoiceAgent.mockClear();
	mockWithdrawConsent.mockResolvedValue({ id: 1 });
});

describe('POST /api/consent/withdraw — S-070 (H-1) observer teardown', () => {
	test('biometric withdraw with active observer → agent disconnected, flag flipped', async () => {
		mockSessions.set(10, { config: { observer_enabled: true, biometric_collection: true } });

		const res = await request(app)
			.post('/api/consent/withdraw')
			.send({ sessionId: 10, type: 'biometric', reason: 'changed mind' });

		expect(res.status).toBe(200);
		expect(res.body.withdrawn).toBe(true);
		expect(mockDisconnectVoiceAgent).toHaveBeenCalledWith(10, 'observer');
		expect(mockSessions.get(10).config.observer_enabled).toBe(false);
	});

	test('biometric withdraw with no active observer → no disconnect call', async () => {
		mockSessions.set(10, { config: { observer_enabled: false } });

		const res = await request(app)
			.post('/api/consent/withdraw')
			.send({ sessionId: 10, type: 'biometric' });

		expect(res.status).toBe(200);
		expect(mockDisconnectVoiceAgent).not.toHaveBeenCalled();
	});

	test('non-biometric withdraw → no observer teardown', async () => {
		mockSessions.set(10, { config: { observer_enabled: true } });

		const res = await request(app)
			.post('/api/consent/withdraw')
			.send({ sessionId: 10, type: 'recording' });

		expect(res.status).toBe(200);
		expect(mockDisconnectVoiceAgent).not.toHaveBeenCalled();
		expect(mockSessions.get(10).config.observer_enabled).toBe(true);
	});

	test('disconnect failure does not fail the withdrawal (best-effort teardown)', async () => {
		mockSessions.set(10, { config: { observer_enabled: true } });
		mockDisconnectVoiceAgent.mockRejectedValueOnce(new Error('LiveKit down'));

		const res = await request(app)
			.post('/api/consent/withdraw')
			.send({ sessionId: 10, type: 'biometric' });

		expect(res.status).toBe(200);
		expect(res.body.withdrawn).toBe(true);
		// Flag still flipped — the flag is the source of truth.
		expect(mockSessions.get(10).config.observer_enabled).toBe(false);
	});
});
