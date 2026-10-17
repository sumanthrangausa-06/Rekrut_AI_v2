/**
 * #1224 (D11): Admin Analytics / Biometric Audit / Email Queue bounce the
 * env-admin to /login — APIs 401 the admin session.
 *
 * The env-admin (POST /api/admin/login, env credentials) holds ONLY a
 * cookie session: req.session.isAdmin = true. No JWT, no users row.
 * These three APIs were gated by JWT-only middleware (lib/auth
 * authMiddleware), so the env-admin session 401'd:
 *   - GET  /api/analytics/dashboard   (routes/analytics.js)
 *   - GET  /api/admin/biometric-audit (routes/admin.js)
 *   - GET  /api/admin/email-queue     (was server.js; moved to routes/admin.js)
 *   - POST /api/admin/email-queue/retry
 *
 * Fix pattern: an admin-session bridge (routes/admin.js) accepts a valid
 * env-admin session — with the SAME idle/absolute timeouts as
 * requireAdmin — and otherwise lets the existing JWT chain run unchanged.
 *
 * Negative controls (security red line): no session/no JWT → 401;
 * non-admin JWT → denied; expired env-admin session → 401.
 */

const request = require('supertest');
const express = require('express');

// ─── Mocked main-app auth (same pattern as admin-biometric-audit.test.js) ────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const role = req.headers['x-test-role'];
		if (!role) return res.status(401).json({ error: 'Authentication required' });
		const companyIdHeader = req.headers['x-test-company-id'];
		req.user = {
			id: 1,
			role,
			company_id: companyIdHeader ? parseInt(companyIdHeader, 10) : null,
		};
		return next();
	});
	const requireRole = (...roles) => (req, res, next) => {
		if (!req.user) return res.status(401).json({ error: 'Authentication required' });
		if (!roles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}
		return next();
	};
	return {
		authMiddleware,
		requireRole,
		optionalAuth: jest.fn((_req, _res, next) => next()),
		verifyToken: () => null,
		hashPassword: jest.fn(async () => 'hash'),
	};
});

// ─── External boundaries ─────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, admin: passthrough },
		distributedRateLimiter: { checkLimit: jest.fn() },
	};
});
jest.mock('../../../lib/activity-logger', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/email-queue', () => ({
	getStats: jest.fn(async () => ({ pending: 2, sent: 5, failed: 1 })),
	retryFailed: jest.fn(async () => [{ id: 1 }, { id: 2 }]),
}));

const pool = require('../../../lib/db');
const adminRoutes = require('../../../routes/admin');
const analyticsRoutes = require('../../../routes/analytics');

// Simulates the express-session state the env-admin login produces.
// x-test-admin-session: valid | expired | (absent)
function sessionStub(req, _res, next) {
	const mode = req.headers['x-test-admin-session'];
	if (mode === 'valid') {
		req.session = {
			isAdmin: true,
			adminLoginAt: new Date().toISOString(),
			lastAdminActivity: new Date().toISOString(),
		};
	} else if (mode === 'expired') {
		req.session = {
			isAdmin: true,
			adminLoginAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
			lastAdminActivity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
		};
	} else {
		req.session = {};
	}
	next();
}

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use(sessionStub);
	app.use('/api/admin', adminRoutes);
	app.use('/api/analytics', analyticsRoutes);
	return app;
}

const BIOMETRIC_ROW = {
	id: 1,
	accessed_at: new Date('2026-10-01T10:00:00Z'),
	user_id: 5,
	user_role: 'recruiter',
	action: 'view',
	data_type: 'face_embedding',
	candidate_id: 42,
	ip_address: '1.2.3.4',
};

beforeEach(() => {
	jest.clearAllMocks();
	pool.query.mockImplementation(async (sql) => {
		if (/COUNT\(\*\)/i.test(sql) && /biometric_audit_log/i.test(sql)) {
			return { rows: [{ total: '1' }] };
		}
		if (/biometric_audit_log/i.test(sql)) return { rows: [BIOMETRIC_ROW] };
		return { rows: [] };
	});
});

// ═══ GET /api/analytics/dashboard ═══════════════════════════════════════════
describe('#1224 GET /api/analytics/dashboard', () => {
	test('200 for env-admin cookie session (no JWT)', async () => {
		const res = await request(makeApp())
			.get('/api/analytics/dashboard?start_date=2026-09-01&end_date=2026-09-02')
			.set('x-test-admin-session', 'valid');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('200 for JWT admin user', async () => {
		const res = await request(makeApp())
			.get('/api/analytics/dashboard?start_date=2026-09-03&end_date=2026-09-04')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(200);
	});

	test('401 with no session and no JWT (negative control)', async () => {
		const res = await request(makeApp()).get('/api/analytics/dashboard');
		expect(res.status).toBe(401);
	});

	test('403 for non-admin JWT user (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/analytics/dashboard')
			.set('x-test-role', 'recruiter');
		expect(res.status).toBe(403);
	});

	test('401 for expired env-admin session (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/analytics/dashboard')
			.set('x-test-admin-session', 'expired');
		expect(res.status).toBe(401);
	});
});

// ═══ GET /api/admin/biometric-audit ═════════════════════════════════════════
describe('#1224 GET /api/admin/biometric-audit', () => {
	test('200 for env-admin cookie session (no JWT), global view + ip visible', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-admin-session', 'valid');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.entries[0]).toHaveProperty('ip_address');
		// env-admin is role 'admin' → no company_id scoping in the query
		const dataQuery = pool.query.mock.calls.find(
			([sql]) => /biometric_audit_log/i.test(sql) && !/COUNT/i.test(sql),
		);
		expect(dataQuery[0]).not.toMatch(/company_id = \$/);
	});

	test('401 with no session and no JWT (negative control)', async () => {
		const res = await request(makeApp()).get('/api/admin/biometric-audit');
		expect(res.status).toBe(401);
	});

	test('403 for non-admin JWT user (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(403);
	});

	test('200 still works for JWT hiring_manager with company scope (regression)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'hiring_manager')
			.set('x-test-company-id', '7');
		expect(res.status).toBe(200);
	});

	test('401 for expired env-admin session (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-admin-session', 'expired');
		expect(res.status).toBe(401);
	});
});

// ═══ /api/admin/email-queue ═════════════════════════════════════════════════
describe('#1224 /api/admin/email-queue', () => {
	test('GET 200 for env-admin cookie session (no JWT)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/email-queue')
			.set('x-test-admin-session', 'valid');
		expect(res.status).toBe(200);
		expect(res.body.stats).toEqual({ pending: 2, sent: 5, failed: 1 });
	});

	test('POST /retry 200 for env-admin cookie session (no JWT)', async () => {
		const res = await request(makeApp())
			.post('/api/admin/email-queue/retry')
			.set('x-test-admin-session', 'valid')
			.send({});
		expect(res.status).toBe(200);
		expect(res.body.retried).toBe(2);
	});

	test('GET 401 with no session and no JWT (negative control)', async () => {
		const res = await request(makeApp()).get('/api/admin/email-queue');
		expect(res.status).toBe(401);
	});

	test('POST /retry 401 with no session and no JWT (negative control)', async () => {
		const res = await request(makeApp()).post('/api/admin/email-queue/retry').send({});
		expect(res.status).toBe(401);
	});

	test('GET 403 for non-admin JWT user (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/email-queue')
			.set('x-test-role', 'recruiter');
		expect(res.status).toBe(403);
	});

	test('GET 200 still works for JWT admin user (regression)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/email-queue')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(200);
	});

	test('GET 401 for expired env-admin session (negative control)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/email-queue')
			.set('x-test-admin-session', 'expired');
		expect(res.status).toBe(401);
	});
});
