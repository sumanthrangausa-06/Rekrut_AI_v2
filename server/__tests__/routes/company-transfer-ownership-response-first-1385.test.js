/**
 * Issue #1385 — POST /transfer-ownership awaits sendOwnershipTransferEmail
 * (same email-stall class as #1353 / #1359, via the sendEmailAsync wrapper).
 *
 * routes/company.js :1394 (on dev at filing) did:
 *   await emailService.sendOwnershipTransferEmail({...})
 * before the updated-company read and res.json. sendOwnershipTransferEmail
 * (lib/email-service.js) delegates to sendEmailAsync -> sendWithRetry ->
 * sendViaBrevoApi, whose fetch has no timeout, so a stalled send withholds
 * the success response indefinitely even though the ownership transfer
 * transaction has already COMMITTED.
 *
 * These tests make sendOwnershipTransferEmail never resolve and assert the
 * response still arrives promptly, and that the send was still attempted
 * once with the unchanged payload. A third test covers Minor 3 from the
 * #1359 review: the register-site owner query must select `id` (it passes
 * rows[0].id as userId; selecting only email,name made it always undefined).
 * The DB mock returns a full row regardless of the select list, so that
 * regression is honestly checked by inspecting the issued SQL text.
 */
const request = require('supertest');
const express = require('express');

// ─── Mock lib/db ────────────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => {
	const serveReads = (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		// register flow (Minor 3 check)
		if (normalized.includes('select id from users where email =')) {
			return { rows: [], rowCount: 0 }; // email not yet registered
		}
		if (normalized.includes('insert into users')) {
			return {
				rows: [
					{
						id: 100,
						email: params[0],
						name: params[2],
						role: 'recruiter',
						company_name: params[3],
						created_at: new Date(),
					},
				],
				rowCount: 1,
			};
		}
		// transfer flow: company + target + final read-back
		if (normalized.includes('select id, owner_id, name from companies where id =')) {
			return { rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }], rowCount: 1 };
		}
		if (
			normalized.includes('select id, name, email, company_id, role, suspended_at from users where id =')
		) {
			return {
				rows: [
					{
						id: 20,
						name: 'New Owner',
						email: 'newowner@acme.com',
						company_id: 1,
						role: 'recruiter',
						suspended_at: null,
					},
				],
				rowCount: 1,
			};
		}
		if (normalized.includes('select c.*')) {
			return { rows: [{ id: 1, owner_id: 20, name: 'Acme Corp' }], rowCount: 1 };
		}
		// register flow: owner lookups (in-app notification + owner email)
		if (normalized.includes('from users where company_id =')) {
			return { rows: [{ id: 10, email: 'owner@acme.com', name: 'Owner' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	};
	const txQuery = jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
			return { rows: [], rowCount: 0 };
		}
		return serveReads(sql, params);
	});
	return {
		query: jest.fn(async (sql, params) => serveReads(sql, params)),
		connect: jest.fn(async () => ({ query: txQuery, release: jest.fn() })),
	};
});

// ─── Mock lib/auth: header-driven user, cheap hashing/tokens ───────────────
jest.mock('../../../lib/auth', () => ({
	generateToken: jest.fn(() => 'test-access-token'),
	generateRefreshToken: jest.fn(async () => ({ token: 'test-refresh-token' })),
	authMiddleware: jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id'] === '10') {
			req.user = { id: 10, email: 'owner@acme.com', role: 'employer', company_id: 1 };
			return next();
		}
		return res.status(401).json({ error: 'Unauthorized' });
	}),
	optionalAuth: jest.fn((_req, _res, next) => next()),
	hashPassword: jest.fn(async () => 'hashed-password'),
}));

// ─── Mock email service: the transfer send NEVER resolves (stalled Brevo) ──
jest.mock('../../../lib/email-service', () => ({
	sendEmailAsync: jest.fn(() => new Promise(() => {})),
	sendOwnershipTransferEmail: jest.fn(() => new Promise(() => {})),
}));

// ─── Other route dependencies ───────────────────────────────────────────────
jest.mock('../../../services/trustscore', () => ({}));
jest.mock('../../../routes/audit', () => ({
	insertAuditLog: jest.fn(async () => {}),
}));
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: jest.fn(() => (_req, _res, next) => next()),
	invalidateUserCache: jest.fn(),
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, standard: passthrough, lenient: passthrough },
		distributedRateLimiter: { checkLimit: jest.fn(async () => ({ allowed: true })) },
	};
});
jest.mock('../../../services/domain-validator', () => {
	const actual = jest.requireActual('../../../services/domain-validator');
	return {
		...actual,
		findCompanyByDomain: jest.fn(async () => ({ id: 1, name: 'Acme Corp', slug: 'acme-corp' })),
		createJoinRequest: jest.fn(async () => ({ id: 7, status: 'pending' })),
	};
});

const emailService = require('../../../lib/email-service');
const pool = require('../../../lib/db');

function createApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/company', require('../../../routes/company'));
	return app;
}

async function raceResponse(responsePromise) {
	const timeoutPromise = new Promise((resolve) =>
		setTimeout(() => resolve({ kind: 'timeout' }), 2000),
	);
	return Promise.race([
		responsePromise.then((res) => ({ kind: 'response', res })),
		timeoutPromise,
	]);
}

describe('routes/company.js — ownership-transfer email must not gate the response (#1385)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// clearAllMocks wipes the never-resolving implementations; restore them.
		emailService.sendOwnershipTransferEmail.mockImplementation(() => new Promise(() => {}));
		emailService.sendEmailAsync.mockImplementation(() => new Promise(() => {}));
	});

	it('POST /transfer-ownership responds 200 even when the ownership email never resolves', async () => {
		const outcome = await raceResponse(
			request(createApp())
				.post('/api/company/transfer-ownership')
				.set('x-test-user-id', '10')
				.send({ newOwnerId: 20 }),
		);
		// Before the fix this is 'timeout': the 200 is gated on the email await.
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(200);
		expect(outcome.res.body.success).toBe(true);
		expect(outcome.res.body.new_owner.id).toBe(20);
		expect(emailService.sendOwnershipTransferEmail).toHaveBeenCalledTimes(1);
		const payload = emailService.sendOwnershipTransferEmail.mock.calls[0][0];
		expect(payload.to).toBe('newowner@acme.com');
		expect(payload.name).toBe('New Owner');
		expect(payload.companyName).toBe('Acme Corp');
		expect(payload.userId).toBe(20);
		expect(payload.metadata).toEqual({
			company_id: 1,
			actor_id: 10,
			trigger: 'ownership_transferred',
		});
	}, 10000);

	it('a rejected fire-and-forget transfer send is logged, never silently dropped', async () => {
		emailService.sendOwnershipTransferEmail.mockImplementation(async () => {
			throw new Error('brevo exploded');
		});
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const outcome = await raceResponse(
				request(createApp())
					.post('/api/company/transfer-ownership')
					.set('x-test-user-id', '10')
					.send({ newOwnerId: 20 }),
			);
			expect(outcome.kind).toBe('response');
			expect(outcome.res.status).toBe(200);
			// Let the fire-and-forget .catch run.
			await new Promise((resolve) => setTimeout(resolve, 50));
			const logged = errorSpy.mock.calls.flat().join(' ');
			expect(logged).toMatch(/company\/transfer-ownership/);
			expect(logged).toMatch(/brevo exploded/);
		} finally {
			errorSpy.mockRestore();
		}
	}, 10000);

	it('register owner-email query selects id so userId is not always undefined (Minor 3)', async () => {
		const outcome = await raceResponse(
			request(createApp())
				.post('/api/company/register')
				.send({
					email: 'new@acme.com',
					password: 'Password123!',
					name: 'New Recruiter',
					company_name: 'Acme Corp',
				}),
		);
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(202);
		const sqlTexts = pool.query.mock.calls.map((c) => String(c[0]));
		const ownerEmailQuery = sqlTexts.find(
			(s) => /from users where company_id/i.test(s) && /email/i.test(s) && /name/i.test(s) && !/select id from/i.test(s),
		);
		expect(ownerEmailQuery).toBeDefined();
		// Before the Minor 3 fix this is "SELECT email, name FROM users ..."
		// and rows[0].id (passed as userId) is always undefined.
		expect(ownerEmailQuery).toMatch(/select id, email, name from users/i);
		expect(emailService.sendEmailAsync).toHaveBeenCalledTimes(1);
		expect(emailService.sendEmailAsync.mock.calls[0][0].userId).toBe(10);
	}, 10000);
});
