/**
 * Issue #1353 — Employer signup hangs on 'Creating account...' forever
 * on the pending-approval path (email domain matches an existing company).
 *
 * Root cause under test: routes/auth.js created the user + join request,
 * then AWAITED the "non-blocking" owner notification email
 * (emailService.sendEmailAsync) BEFORE sending the 202 response.
 * sendEmailAsync wraps a Brevo fetch with no timeout, so a stalled
 * email send withholds the signup response indefinitely — the account
 * exists server-side but the UI spinner never clears.
 *
 * This test makes sendEmailAsync never resolve and asserts the 202
 * pending_approval response still arrives promptly.
 */
const request = require('supertest');
const express = require('express');

// ─── Mock lib/db ────────────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		if (normalized.includes('select id from users where email =')) {
			return { rows: [], rowCount: 0 }; // email not yet registered
		}
		if (normalized.includes('insert into users')) {
			return {
				rows: [
					{
						id: 42,
						email: params[0],
						name: params[2],
						role: params[3],
						company_name: params[4],
						created_at: new Date(),
					},
				],
				rowCount: 1,
			};
		}
		if (normalized.includes('select id, email, name from users where id =')) {
			return { rows: [{ id: 10, email: 'owner@acme.com', name: 'Owner' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}),
}));

// ─── Mock lib/auth ──────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => ({
	generateToken: jest.fn(() => 'test-access-token'),
	generateRefreshToken: jest.fn(async () => ({ token: 'test-refresh-token' })),
	rotateRefreshToken: jest.fn(async () => ({ token: 'test-refresh-token' })),
	revokeAllTokens: jest.fn(async () => {}),
	authMiddleware: jest.fn((_req, _res, next) => next()),
	hashPassword: jest.fn(async () => 'hashed-password'),
	needsRehash: jest.fn(() => false),
}));

// ─── Mock email service: the owner notification NEVER resolves ─────────────
jest.mock('../../../lib/email-service', () => ({
	sendEmailAsync: jest.fn(() => new Promise(() => {})), // stalled send (e.g. hung Brevo fetch)
	sendTemplatedEmail: jest.fn(async () => ({ success: true })),
}));

// ─── Other route dependencies ───────────────────────────────────────────────
jest.mock('../../../lib/crypto-utils', () => ({
	encrypt: jest.fn((v) => v),
	decrypt: jest.fn((v) => v),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(async () => ({})),
}));
jest.mock('../../../lib/erasureResultSanitizer', () => ({
	sanitizeErasureResult: jest.fn((v) => v),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn(async () => {}) })),
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, standard: passthrough, lenient: passthrough },
		distributedRateLimiter: {
			checkLimit: jest.fn(async () => ({ allowed: true, retryAfter: 0 })),
		},
	};
});
jest.mock('../../../services/domain-validator', () => {
	const actual = jest.requireActual('../../../services/domain-validator');
	return {
		...actual,
		findCompanyByDomain: jest.fn(async () => ({
			id: 1,
			name: 'Acme Corp',
			owner_id: 10,
		})),
		createJoinRequest: jest.fn(async () => ({ id: 7, status: 'pending' })),
	};
});

const emailService = require('../../../lib/email-service');

function createApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/auth', require('../../../routes/auth'));
	return app;
}

describe('POST /api/auth/register — pending-approval path (#1353)', () => {
	it('responds 202 pending_approval promptly even when the owner notification email never resolves', async () => {
		const app = createApp();
		const responsePromise = request(app)
			.post('/api/auth/register')
			.send({
				email: 'newhire@acme.com',
				password: 'Password123',
				name: 'New Hire',
				role: 'employer',
				company_name: 'Acme Corp',
			})
			.then((res) => ({ kind: 'response', res }));

		const timeoutPromise = new Promise((resolve) =>
			setTimeout(() => resolve({ kind: 'timeout' }), 2000),
		);

		const outcome = await Promise.race([responsePromise, timeoutPromise]);

		// Before the fix this is 'timeout': the 202 is gated on the email await.
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(202);
		expect(outcome.res.body.pending_approval).toBe(true);
		// The owner notification is still attempted — just not awaited.
		expect(emailService.sendEmailAsync).toHaveBeenCalledTimes(1);
		expect(emailService.sendEmailAsync.mock.calls[0][0].to).toBe('owner@acme.com');
	}, 10000);
});
