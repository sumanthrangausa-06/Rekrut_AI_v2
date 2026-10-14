/**
 * #799 (G-1) — Lex F-1 (PR-gate fix round): the SELF-SERVE delete-account
 * 409 must leave a durable record in compliance_audit_trail (hold id,
 * actor, subject), and must not claim recording when that write fails.
 *
 * routes/auth.js is imported with its boundaries mocked; erasePersonalData
 * is mocked to throw the typed LegalHoldError, exactly as the real erasure
 * gate does after rolling the deletion transaction back.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/crypto-utils', () => ({
	encrypt: jest.fn((x) => x),
	decrypt: jest.fn((x) => x),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
	deleteErasedStorageFiles: jest.fn().mockResolvedValue({ deleted: 0, failed: 0, failures: [] }),
}));
jest.mock('../../../lib/auth', () => {
	const bcryptInner = require('bcryptjs');
	return {
		generateToken: jest.fn(() => 'tok'),
		generateRefreshToken: jest.fn(async () => ({ token: 'rtok' })),
		rotateRefreshToken: jest.fn(),
		revokeAllTokens: jest.fn(async () => {}),
		// Test user: candidate 7 with a password (bcrypt hash of 'DeleteMe123!')
		authMiddleware: jest.fn((req, _res, next) => {
			req.user = {
				id: 7,
				role: 'candidate',
				company_id: null,
				password_hash: bcryptInner.hashSync('DeleteMe123!', 4),
			};
			next();
		}),
	};
});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
	logEvent: jest.fn(async () => ({ id: 'audit-1' })),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', COMPANY: 'company', USER: 'user', RETENTION_PURGE: 'retention_purge' },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return { rateLimits: { strict: passthrough, admin: passthrough } };
});
jest.mock('../../../lib/email-service', () => ({}));
jest.mock('../../../lib/legalHold', () => {
	class LegalHoldError extends Error {
		constructor(message, details) {
			super(message);
			this.name = 'LegalHoldError';
			this.code = 'LEGAL_HOLD';
			this.status = 409;
			this.details = details;
		}
	}
	return {
		LegalHoldError,
		isHeld: jest.fn(async () => false),
		findActiveHold: jest.fn(async () => null),
		recordLegalHoldConflict: jest.fn(async () => ({})),
	};
});

const pool = require('../../../lib/db');
const { erasePersonalData } = require('../../../lib/erasureService');
const legalHold = require('../../../lib/legalHold');
const authRoutes = require('../../../routes/auth');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/auth', authRoutes);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	legalHold.recordLegalHoldConflict.mockResolvedValue({});
	const client = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })), release: jest.fn() };
	pool.connect.mockResolvedValue(client);
	const err = new legalHold.LegalHoldError('held', { userId: 7, holdId: 5 });
	erasePersonalData.mockRejectedValue(err);
});

describe('DELETE /delete-account under an active legal hold (Lex F-1)', () => {
	test('409, nothing deleted, and the conflict is recorded in the compliance audit trail (hold id + actor + subject)', async () => {
		const res = await request(makeApp())
			.delete('/api/auth/delete-account')
			.send({ password: 'DeleteMe123!' });

		expect(res.status).toBe(409);
		expect(res.body.legalHold).toBe(true);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledTimes(1);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledWith(
			expect.objectContaining({
				holdId: 5,
				subjectUserId: 7,
				source: 'self_serve_delete_account',
			}),
		);
		const arg = legalHold.recordLegalHoldConflict.mock.calls[0][0];
		expect(arg.actor).toBe(7); // the requesting user is the actor on this path
	});

	test('if the audit-trail write FAILS, the response surfaces the failure instead of a clean 409 (fail closed)', async () => {
		legalHold.recordLegalHoldConflict.mockRejectedValue(new Error('audit trail down'));
		const res = await request(makeApp())
			.delete('/api/auth/delete-account')
			.send({ password: 'DeleteMe123!' });

		expect(res.status).toBe(500);
		expect(res.body.error).toMatch(/could not be recorded/i);
	});
});
