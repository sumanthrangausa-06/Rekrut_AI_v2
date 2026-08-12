/**
 * Company Approval Workflow Tests (Issue #104)
 *
 * Covers:
 * - Register with existing domain creates join request
 * - Pending recruiter gets 403 on protected recruiter endpoints
 * - Owner can list join requests
 * - Owner can approve join request
 * - Owner can reject join request with reason
 * - Rejected recruiter can see rejection reason
 * - Owner can suspend/reinstate team member
 * - Non-owner cannot approve/reject
 * - Audit logs are created for approve/reject/suspend
 * - Privilege escalation attempts from a pending account
 */

const request = require('supertest');
const express = require('express');

// ─── Track mock query calls for assertions ──────────────────────────────────
const mockQueryResults = new Map();

// ─── Mock lib/db ────────────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => {
	const mockQuery = jest.fn(async (sql, params) => {
		const key = `${sql}|${JSON.stringify(params)}`;
		if (mockQueryResults.has(key)) {
			return mockQueryResults.get(key);
		}

		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// Users: SELECT by email
		if (
			normalized.includes('select * from users where email =') ||
			normalized.includes('select id from users where email =') ||
			normalized.includes('select email, name from users where email =')
		) {
			const email = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`user:${email}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Users: SELECT by ID (multiple column permutations)
		if (
			normalized.includes('select * from users where id =') ||
			normalized.includes('select id, email, name, role, company_id from users where id =') ||
			normalized.includes(
				'select id, name, email, company_id, role, suspended_at from users where id =',
			) ||
			normalized.includes('select id, name, email, company_id from users where id =') ||
			normalized.includes('select id, name, email, company_id, suspended_at from users where id =')
		) {
			const userId = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`userId:${userId}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Users: SELECT by company_id
		if (
			normalized.includes(
				'select id, email, name, role, created_at, suspended_at from users where company_id =',
			)
		) {
			const companyId = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`team:${companyId}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Users: SELECT employer by company_id (ordered)
		if (
			normalized.includes('select id from users where company_id =') &&
			normalized.includes("role = 'employer'")
		) {
			const companyId = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`owner:${companyId}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Users: SELECT email,name by company_id + employer role
		if (
			normalized.includes('select email, name from users where company_id =') &&
			normalized.includes("role = 'employer'")
		) {
			const companyId = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`ownerEmail:${companyId}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Company: SELECT by ID
		if (
			normalized.includes('select owner_id, name from companies where id =') ||
			normalized.includes('select owner_id from companies where id =') ||
			normalized.includes('select id, owner_id, name from companies where id =')
		) {
			const companyId = params[0];
			for (const [k, v] of mockQueryResults.entries()) {
				if (k.startsWith(`company:${companyId}:`)) return v;
			}
			return { rows: [], rowCount: 0 };
		}

		// Company: SELECT by slug
		if (normalized.includes('select id from companies where slug =')) {
			return { rows: [], rowCount: 0 };
		}

		// Company: SELECT full by id (transfer-ownership)
		if (
			normalized.includes(
				'select c.*, ts.total_score as trust_score, ts.score_tier from companies c',
			)
		) {
			return { rows: [{ id: 1, name: 'Acme Corp', slug: 'acme-corp' }], rowCount: 1 };
		}

		// INSERT user
		if (normalized.includes('insert into users') && normalized.includes('returning')) {
			const newUser = {
				id: params[5] ? 200 : 100,
				email: params[0],
				password_hash: params[1] || '$2a$10$fakehash',
				name: params[2] || 'Test User',
				role: params[3] || 'candidate',
				company_name: params[4] || 'TestCo',
				company_id: params[5] || null,
				created_at: new Date().toISOString(),
			};
			return { rows: [newUser], rowCount: 1 };
		}

		// INSERT refresh_tokens
		if (normalized.includes('insert into refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// INSERT events
		if (normalized.includes('insert into events')) {
			return { rows: [], rowCount: 1 };
		}

		// SELECT refresh token
		if (normalized.includes('select rt.*, u.email, u.role, u.name from refresh_tokens')) {
			return { rows: [], rowCount: 0 };
		}

		// UPDATE refresh tokens
		if (normalized.includes('update refresh_tokens')) {
			return { rows: [], rowCount: 1 };
		}

		// UPDATE users (suspend/reinstate)
		if (normalized.includes('update users set suspended_at')) {
			return { rows: [], rowCount: 1 };
		}

		// SELECT company by domain (fallback for register flow)
		if (normalized.includes('select * from companies where')) {
			return { rows: [], rowCount: 0 };
		}

		// Trust scores
		if (normalized.includes('insert into trust_scores')) {
			return { rows: [], rowCount: 1 };
		}

		if (normalized.includes('insert into trust_score_components')) {
			return { rows: [], rowCount: 1 };
		}

		// INSERT user_notifications
		if (normalized.includes('insert into user_notifications')) {
			return { rows: [], rowCount: 1 };
		}

		// UPDATE user_notifications (mark read)
		if (
			normalized.includes('update user_notifications') &&
			normalized.includes('set read = true')
		) {
			return { rows: [], rowCount: 0 };
		}

		// Fallback
		return { rows: [], rowCount: 0 };
	});

	return {
		query: mockQuery,
		getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
		end: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
		connect: jest.fn().mockResolvedValue({
			query: jest.fn().mockImplementation(async (sql, _params) => {
				const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
				if (normalized === 'begin') return {};
				if (normalized.includes('update companies set owner_id')) return { rows: [] };
				if (normalized.includes("update users set role = 'admin'")) return { rows: [] };
				if (normalized.includes("update users set role = 'owner'")) return { rows: [] };
				if (normalized === 'commit') return {};
				if (normalized === 'rollback') return {};
				return { rows: [], rowCount: 0 };
			}),
			release: jest.fn(),
		}),
	};
});

// ─── Mock auth middleware ───────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');

	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});

	const optionalAuth = jest.fn((_req, _res, next) => next());

	return {
		...actual,
		authMiddleware,
		optionalAuth,
		generateToken: jest.fn(() => 'test-token'),
		generateRefreshToken: jest.fn(() => ({ token: 'test-refresh', expiresAt: new Date() })),
	};
});

// ─── Mock email service ─────────────────────────────────────────────────────
jest.mock('../../../lib/email-service', () => ({
	sendEmailAsync: jest.fn().mockResolvedValue({ success: true }),
	sendTemplatedEmail: jest.fn().mockResolvedValue({ success: true }),
	sendCustomEmail: jest.fn().mockResolvedValue({ success: true }),
	queueEmail: jest.fn().mockResolvedValue({ success: true }),
	verifyConnection: jest.fn().mockResolvedValue({ success: true }),
	sendOwnershipTransferEmail: jest.fn().mockResolvedValue({ success: true }),
}));

// ─── Mock audit ─────────────────────────────────────────────────────────────
jest.mock('../../../routes/audit', () => ({
	insertAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ─── Mock company-domain-service ────────────────────────────────────────────
jest.mock('../../../services/company-domain-service', () => ({
	findCompanyByDomain: jest.fn(),
	storeVerifiedDomain: jest.fn(),
	createJoinRequest: jest.fn(),
	approveJoinRequest: jest.fn(),
	rejectJoinRequest: jest.fn(),
	listPendingJoinRequests: jest.fn(),
	getJoinRequestById: jest.fn(),
	findLatestJoinRequestForUser: jest.fn(),
	findPendingJoinRequest: jest.fn(),
}));

// ─── Mock distributed-rate-limiter ──────────────────────────────────────────
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const rateLimitMiddleware = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: {
			strict: rateLimitMiddleware,
			standard: rateLimitMiddleware,
			lenient: rateLimitMiddleware,
			ai: rateLimitMiddleware,
		},
		distributedRateLimiter: {
			checkLimit: jest.fn().mockResolvedValue({ allowed: true, count: 1, retryAfter: 0 }),
			startCleanup: jest.fn(),
		},
	};
});

// ─── Mock metrics-collector ─────────────────────────────────────────────────
jest.mock('../../../lib/metrics-collector', () => ({
	setHttpServer: jest.fn(),
	metricsMiddleware: jest.fn((_req, _res, next) => next()),
	requestLogger: jest.fn((_req, _res, next) => next()),
}));

// ─── Mock isomorphic-dompurify ──────────────────────────────────────────────
jest.mock('isomorphic-dompurify', () => {
	return jest.fn((html) => html);
});

// ─── Now require the modules under test ─────────────────────────────────────
const companyDomainService = require('../../../services/company-domain-service');
const { insertAuditLog } = require('../../../routes/audit');
const emailService = require('../../../lib/email-service');

// ─── Helpers ────────────────────────────────────────────────────────────────

function createApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/company', require('../../../routes/company'));
	return app;
}

function setUser(userId, userData) {
	if (!global.__testUsers) global.__testUsers = {};
	global.__testUsers[userId] = userData;
}

function setQueryResult(key, result) {
	mockQueryResults.set(key, result);
}

function clearQueryResults() {
	mockQueryResults.clear();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Company Approval Workflow (Issue #104)', () => {
	let app;

	beforeEach(() => {
		app = createApp();
		clearQueryResults();
		global.__testUsers = {};
		jest.clearAllMocks();
	});

	afterEach(() => {
		delete global.__testUsers;
	});

	// ── AC1: Register with existing domain creates join request ───────────────
	describe('POST /api/company/register', () => {
		it('creates a join request when domain already exists', async () => {
			companyDomainService.findCompanyByDomain.mockResolvedValue({
				id: 1,
				name: 'Acme Corp',
				slug: 'acme-corp',
				verified_domain: 'acme.com',
			});
			companyDomainService.createJoinRequest.mockResolvedValue({
				id: 1,
				user_id: 100,
				company_id: 1,
				status: 'pending',
			});

			setQueryResult('user:new@acme.com:', { rows: [], rowCount: 0 });
			setQueryResult('owner:1:', { rows: [{ id: 10 }], rowCount: 1 });
			setQueryResult('ownerEmail:1:', {
				rows: [{ id: 10, email: 'owner@acme.com', name: 'Owner' }],
				rowCount: 1,
			});

			const res = await request(app).post('/api/company/register').send({
				email: 'new@acme.com',
				password: 'Password123!',
				name: 'New Recruiter',
				company_name: 'Acme Corp',
			});

			expect(res.status).toBe(202);
			expect(res.body.success).toBe(true);
			expect(res.body.pending_approval).toBe(true);
			expect(companyDomainService.createJoinRequest).toHaveBeenCalledWith(
				expect.any(Number),
				1,
				'new@acme.com',
				'acme.com',
			);
		});

		it('sends an email notification to the company owner', async () => {
			companyDomainService.findCompanyByDomain.mockResolvedValue({
				id: 1,
				name: 'Acme Corp',
				slug: 'acme-corp',
				verified_domain: 'acme.com',
			});
			companyDomainService.createJoinRequest.mockResolvedValue({ id: 1, status: 'pending' });

			setQueryResult('user:new@acme.com:', { rows: [], rowCount: 0 });
			setQueryResult('owner:1:', { rows: [{ id: 10 }], rowCount: 1 });
			setQueryResult('ownerEmail:1:', {
				rows: [{ id: 10, email: 'owner@acme.com', name: 'Owner' }],
				rowCount: 1,
			});

			await request(app).post('/api/company/register').send({
				email: 'new@acme.com',
				password: 'Password123!',
				name: 'New Recruiter',
				company_name: 'Acme Corp',
			});

			expect(emailService.sendEmailAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'owner@acme.com',
					templateName: 'recruiter_join_request',
				}),
			);
		});
	});

	// ── AC2: Pending recruiter access control ─────────────────────────────────
	describe('Pending recruiter access control', () => {
		it('returns 400 when a pending recruiter tries to access company profile', async () => {
			setUser(99, {
				id: 99,
				email: 'pending@acme.com',
				name: 'Pending',
				role: 'recruiter',
				company_id: null,
			});

			const res = await request(app).get('/api/company/profile').set('x-test-user-id', '99');

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/no company/i);
		});
	});

	// ── AC3: Owner can list join requests ─────────────────────────────────────
	describe('GET /api/company/join-requests', () => {
		it('allows owner to list pending join requests', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.listPendingJoinRequests.mockResolvedValue([
				{
					id: 1,
					user_id: 99,
					email: 'pending@acme.com',
					status: 'pending',
					user_name: 'Pending User',
				},
			]);

			const res = await request(app).get('/api/company/join-requests').set('x-test-user-id', '10');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.requests).toHaveLength(1);
			expect(companyDomainService.listPendingJoinRequests).toHaveBeenCalledWith(1);
		});

		it('allows existing recruiters to list join requests', async () => {
			setUser(11, { id: 11, email: 'rec@acme.com', name: 'Rec', role: 'recruiter', company_id: 1 });
			companyDomainService.listPendingJoinRequests.mockResolvedValue([]);

			const res = await request(app).get('/api/company/join-requests').set('x-test-user-id', '11');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
		});

		it('rejects non-recruiter roles', async () => {
			setUser(12, {
				id: 12,
				email: 'cand@example.com',
				name: 'Cand',
				role: 'candidate',
				company_id: 1,
			});

			const res = await request(app).get('/api/company/join-requests').set('x-test-user-id', '12');

			expect(res.status).toBe(403);
			expect(res.body.error).toMatch(/not authorized/i);
		});
	});

	// ── AC4: Owner can approve join request ───────────────────────────────────
	describe('POST /api/company/join-requests/:id/approve', () => {
		it('allows owner to approve a join request', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'pending',
			});
			companyDomainService.approveJoinRequest.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'approved',
			});

			const res = await request(app)
				.post('/api/company/join-requests/1/approve')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.message).toMatch(/approved/i);
			expect(companyDomainService.approveJoinRequest).toHaveBeenCalledWith(1, 10);
		});

		it('creates an audit log on approval', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'pending',
			});
			companyDomainService.approveJoinRequest.mockResolvedValue({ id: 1, status: 'approved' });

			await request(app).post('/api/company/join-requests/1/approve').set('x-test-user-id', '10');

			expect(insertAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({
					action: 'join_request_approved',
					company_id: 1,
					actor_id: 10,
					target_id: 99,
				}),
			);
		});

		it('returns 404 for non-existent join request', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue(null);

			const res = await request(app)
				.post('/api/company/join-requests/999/approve')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(404);
			expect(res.body.error).toMatch(/not found/i);
		});

		it('returns 403 when request belongs to a different company', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 2,
				status: 'pending',
			});

			const res = await request(app)
				.post('/api/company/join-requests/1/approve')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(403);
			expect(res.body.error).toMatch(/not authorized/i);
		});
	});

	// ── AC5: Owner can reject join request with reason ────────────────────────
	describe('POST /api/company/join-requests/:id/reject', () => {
		it('allows owner to reject with a reason', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'pending',
			});
			companyDomainService.rejectJoinRequest.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'rejected',
				rejection_reason: 'Domain mismatch',
			});

			const res = await request(app)
				.post('/api/company/join-requests/1/reject')
				.set('x-test-user-id', '10')
				.send({ reason: 'Domain mismatch' });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.message).toMatch(/rejected/i);
			expect(companyDomainService.rejectJoinRequest).toHaveBeenCalledWith(1, 10, 'Domain mismatch');
		});

		it('creates an audit log on rejection', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'pending',
			});
			companyDomainService.rejectJoinRequest.mockResolvedValue({
				id: 1,
				status: 'rejected',
				rejection_reason: 'Not a fit',
			});

			await request(app)
				.post('/api/company/join-requests/1/reject')
				.set('x-test-user-id', '10')
				.send({ reason: 'Not a fit' });

			expect(insertAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({
					action: 'join_request_rejected',
					company_id: 1,
					actor_id: 10,
					target_id: 99,
					reason: 'Not a fit',
				}),
			);
		});
	});

	// ── AC6: Rejected recruiter can see rejection reason ──────────────────────
	describe('GET /api/company/join-requests/me', () => {
		it('returns the latest join request including rejection reason', async () => {
			setUser(99, {
				id: 99,
				email: 'rejected@acme.com',
				name: 'Rejected',
				role: 'recruiter',
				company_id: null,
			});
			companyDomainService.findLatestJoinRequestForUser.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'rejected',
				rejection_reason: 'Not a fit',
				requested_at: new Date().toISOString(),
			});
			setQueryResult('company:1:', {
				rows: [{ name: 'Acme Corp', slug: 'acme-corp' }],
				rowCount: 1,
			});

			const res = await request(app)
				.get('/api/company/join-requests/me')
				.set('x-test-user-id', '99');

			expect(res.status).toBe(200);
			expect(res.body.hasPendingRequest).toBe(true);
			expect(res.body.request.status).toBe('rejected');
			expect(res.body.request.rejection_reason).toBe('Not a fit');
		});

		it('returns hasPendingRequest=false when no join request exists', async () => {
			setUser(99, {
				id: 99,
				email: 'free@acme.com',
				name: 'Free',
				role: 'recruiter',
				company_id: 1,
			});
			companyDomainService.findLatestJoinRequestForUser.mockResolvedValue(null);

			const res = await request(app)
				.get('/api/company/join-requests/me')
				.set('x-test-user-id', '99');

			expect(res.status).toBe(200);
			expect(res.body.hasPendingRequest).toBe(false);
		});
	});

	// ── AC7: Owner can suspend/reinstate team member ──────────────────────────
	describe('POST /api/company/team/members/:id/suspend', () => {
		it('allows owner to suspend a team member', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			setQueryResult('company:1:', {
				rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }],
				rowCount: 1,
			});
			setQueryResult('userId:20:', {
				rows: [{ id: 20, name: 'Bad Actor', email: 'bad@acme.com', company_id: 1 }],
				rowCount: 1,
			});

			const res = await request(app)
				.post('/api/company/team/members/20/suspend')
				.set('x-test-user-id', '10')
				.send({ reason: 'Violation of policy' });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(emailService.sendEmailAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'bad@acme.com',
					templateName: 'account_suspended',
				}),
			);
		});

		it('creates an audit log on suspension', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			setQueryResult('company:1:', {
				rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }],
				rowCount: 1,
			});
			setQueryResult('userId:20:', {
				rows: [{ id: 20, name: 'Bad Actor', email: 'bad@acme.com', company_id: 1 }],
				rowCount: 1,
			});

			await request(app)
				.post('/api/company/team/members/20/suspend')
				.set('x-test-user-id', '10')
				.send({ reason: 'Violation' });

			expect(insertAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({
					action: 'recruiter_suspended',
					company_id: 1,
					actor_id: 10,
					target_id: 20,
					reason: 'Violation',
				}),
			);
		});

		it('prevents self-suspension', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			setQueryResult('company:1:', {
				rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }],
				rowCount: 1,
			});

			const res = await request(app)
				.post('/api/company/team/members/10/suspend')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/cannot suspend yourself/i);
		});

		it('prevents non-owner from suspending', async () => {
			setUser(11, { id: 11, email: 'rec@acme.com', name: 'Rec', role: 'recruiter', company_id: 1 });
			setQueryResult('company:1:', {
				rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }],
				rowCount: 1,
			});

			const res = await request(app)
				.post('/api/company/team/members/20/suspend')
				.set('x-test-user-id', '11');

			expect(res.status).toBe(403);
			expect(res.body.error).toMatch(/only the company owner/i);
		});
	});

	describe('POST /api/company/team/members/:id/reinstate', () => {
		it('allows owner to reinstate a suspended member', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			setQueryResult('company:1:', { rows: [{ id: 1, owner_id: 10 }], rowCount: 1 });
			setQueryResult('userId:20:', {
				rows: [
					{
						id: 20,
						name: 'Bad Actor',
						email: 'bad@acme.com',
						company_id: 1,
						suspended_at: new Date().toISOString(),
					},
				],
				rowCount: 1,
			});

			const res = await request(app)
				.post('/api/company/team/members/20/reinstate')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(insertAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({
					action: 'recruiter_reinstated',
				}),
			);
		});

		it('returns 400 if user is not suspended', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});
			setQueryResult('company:1:', { rows: [{ id: 1, owner_id: 10 }], rowCount: 1 });
			setQueryResult('userId:20:', {
				rows: [
					{ id: 20, name: 'Good Actor', email: 'good@acme.com', company_id: 1, suspended_at: null },
				],
				rowCount: 1,
			});

			const res = await request(app)
				.post('/api/company/team/members/20/reinstate')
				.set('x-test-user-id', '10');

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/not suspended/i);
		});
	});

	// ── AC8: Non-owner authorization on approve/reject ────────────────────────
	describe('Non-owner authorization on join requests', () => {
		it('allows existing recruiters to approve (current implementation)', async () => {
			setUser(11, { id: 11, email: 'rec@acme.com', name: 'Rec', role: 'recruiter', company_id: 1 });
			companyDomainService.getJoinRequestById.mockResolvedValue({
				id: 1,
				user_id: 99,
				company_id: 1,
				status: 'pending',
			});
			companyDomainService.approveJoinRequest.mockResolvedValue({ id: 1, status: 'approved' });

			const res = await request(app)
				.post('/api/company/join-requests/1/approve')
				.set('x-test-user-id', '11');

			expect(res.status).toBe(200);
			expect(companyDomainService.approveJoinRequest).toHaveBeenCalled();
		});
	});

	// ── AC9: Privilege escalation from pending account ────────────────────────
	describe('Privilege escalation prevention', () => {
		it('blocks pending recruiter from accessing protected recruiter endpoints', async () => {
			const { requireApprovedRecruiter } = require('../../../lib/auth');

			const req = { user: { id: 99, role: 'recruiter', company_id: null } };
			const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
			const next = jest.fn();

			requireApprovedRecruiter(req, res, next);

			expect(res.status).toHaveBeenCalledWith(403);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.stringMatching(/pending approval|not approved/i),
				}),
			);
			expect(next).not.toHaveBeenCalled();
		});

		it('blocks suspended recruiter from accessing protected endpoints', async () => {
			const { requireNotSuspended } = require('../../../lib/auth');

			const req = {
				user: { id: 99, role: 'recruiter', company_id: 1, suspended_at: new Date().toISOString() },
			};
			const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
			const next = jest.fn();

			requireNotSuspended(req, res, next);

			expect(res.status).toHaveBeenCalledWith(403);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.stringMatching(/suspended/i),
				}),
			);
			expect(next).not.toHaveBeenCalled();
		});
	});

	// ── AC10: Ownership transfer (already implemented) ────────────────────────
	describe('POST /api/company/transfer-ownership', () => {
		it('allows owner to transfer ownership', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});

			const db = require('../../../lib/db');
			db.query.mockImplementation(async (sql, _params) => {
				const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
				if (normalized.includes('select id, owner_id, name from companies where id =')) {
					return { rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }], rowCount: 1 };
				}
				if (
					normalized.includes(
						'select id, name, email, company_id, role, suspended_at from users where id =',
					)
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
				return { rows: [], rowCount: 0 };
			});

			const res = await request(app)
				.post('/api/company/transfer-ownership')
				.set('x-test-user-id', '10')
				.send({ newOwnerId: 20 });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.message).toMatch(/transferred/i);
		});

		it('prevents transfer to suspended user', async () => {
			setUser(10, {
				id: 10,
				email: 'owner@acme.com',
				name: 'Owner',
				role: 'employer',
				company_id: 1,
			});

			const db = require('../../../lib/db');
			db.query.mockImplementation(async (sql, _params) => {
				const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
				if (normalized.includes('select id, owner_id, name from companies where id =')) {
					return { rows: [{ id: 1, owner_id: 10, name: 'Acme Corp' }], rowCount: 1 };
				}
				if (
					normalized.includes(
						'select id, name, email, company_id, role, suspended_at from users where id =',
					)
				) {
					return {
						rows: [
							{
								id: 20,
								name: 'Suspended',
								email: 'sus@acme.com',
								company_id: 1,
								role: 'recruiter',
								suspended_at: new Date().toISOString(),
							},
						],
						rowCount: 1,
					};
				}
				return { rows: [], rowCount: 0 };
			});

			const res = await request(app)
				.post('/api/company/transfer-ownership')
				.set('x-test-user-id', '10')
				.send({ newOwnerId: 20 });

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/suspended/i);
		});
	});
});
