/**
 * Issue #1359 — routes/company.js awaited email-send pattern can stall
 * responses (same defect class as #1353).
 *
 * Three handlers AWAITED emailService.sendEmailAsync in the response path:
 *   - POST /company/register (existing-domain branch) — :148, before the 202
 *   - POST /company/team/members/:id/suspend          — :1028, before res.json
 *   - POST /company/members/:id/suspend (alias)       — :1183, before res.json
 * sendEmailAsync wraps a Brevo fetch with no timeout, so a stalled send
 * withholds the HTTP response indefinitely even though the durable work
 * (user + join request created / member already suspended) is done.
 *
 * These tests make sendEmailAsync never resolve and assert each response
 * still arrives promptly, and that the send was still attempted once.
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
		if (normalized.includes('select owner_id, name from companies where id =')) {
			return { rows: [{ owner_id: 10, name: 'Acme Corp' }], rowCount: 1 };
		}
		if (normalized.includes('select id, name, email, company_id from users where id =')) {
			return {
				rows: [{ id: 20, name: 'Bad Actor', email: 'bad@acme.com', company_id: 1 }],
				rowCount: 1,
			};
		}
		if (
			normalized.includes('select id from users where company_id =') ||
			normalized.includes('select email, name from users where company_id =')
		) {
			return { rows: [{ id: 10, email: 'owner@acme.com', name: 'Owner' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}),
	connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })),
}));

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

// ─── Mock email service: the send NEVER resolves (stalled Brevo fetch) ─────
jest.mock('../../../lib/email-service', () => ({
	sendEmailAsync: jest.fn(() => new Promise(() => {})),
	sendOwnershipTransferEmail: jest.fn(async () => ({ success: true })),
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

describe('routes/company.js — email send must not gate the response (#1359)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// clearAllMocks wipes the never-resolving implementation; restore it.
		emailService.sendEmailAsync.mockImplementation(() => new Promise(() => {}));
	});

	it('POST /register (existing domain) responds 202 pending_approval even when the owner email never resolves', async () => {
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
		// Before the fix this is 'timeout': the 202 is gated on the email await.
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(202);
		expect(outcome.res.body.pending_approval).toBe(true);
		expect(emailService.sendEmailAsync).toHaveBeenCalledTimes(1);
		expect(emailService.sendEmailAsync.mock.calls[0][0].to).toBe('owner@acme.com');
		expect(emailService.sendEmailAsync.mock.calls[0][0].templateName).toBe(
			'recruiter_join_request',
		);
	}, 10000);

	it('POST /team/members/:id/suspend responds 200 even when the suspension email never resolves', async () => {
		const outcome = await raceResponse(
			request(createApp())
				.post('/api/company/team/members/20/suspend')
				.set('x-test-user-id', '10')
				.send({ reason: 'Violation of policy' }),
		);
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(200);
		expect(outcome.res.body.success).toBe(true);
		expect(emailService.sendEmailAsync).toHaveBeenCalledTimes(1);
		expect(emailService.sendEmailAsync.mock.calls[0][0].to).toBe('bad@acme.com');
		expect(emailService.sendEmailAsync.mock.calls[0][0].templateName).toBe('account_suspended');
	}, 10000);

	it('POST /members/:id/suspend (alias) responds 200 even when the suspension email never resolves', async () => {
		const outcome = await raceResponse(
			request(createApp())
				.post('/api/company/members/20/suspend')
				.set('x-test-user-id', '10')
				.send({ reason: 'Violation of policy' }),
		);
		expect(outcome.kind).toBe('response');
		expect(outcome.res.status).toBe(200);
		expect(outcome.res.body.success).toBe(true);
		expect(emailService.sendEmailAsync).toHaveBeenCalledTimes(1);
		expect(emailService.sendEmailAsync.mock.calls[0][0].to).toBe('bad@acme.com');
	}, 10000);

	it('a rejected fire-and-forget send is logged, never silently dropped', async () => {
		emailService.sendEmailAsync.mockImplementation(async () => {
			throw new Error('brevo exploded');
		});
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const outcome = await raceResponse(
				request(createApp())
					.post('/api/company/team/members/20/suspend')
					.set('x-test-user-id', '10')
					.send({ reason: 'Violation of policy' }),
			);
			expect(outcome.kind).toBe('response');
			expect(outcome.res.status).toBe(200);
			// Let the fire-and-forget .catch run.
			await new Promise((resolve) => setTimeout(resolve, 50));
			const logged = errorSpy.mock.calls.flat().join(' ');
			expect(logged).toMatch(/company\/suspend/);
			expect(logged).toMatch(/brevo exploded/);
		} finally {
			errorSpy.mockRestore();
		}
	}, 10000);
});
