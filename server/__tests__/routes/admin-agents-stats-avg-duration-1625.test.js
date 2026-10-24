/**
 * #1625 — GET /admin/agents/stats fabricated an avg_duration of 0 when
 * no agent run had completed: the SQL wrapped AVG(...) in
 * COALESCE(..., 0), the safeQuery fallback row was {avg_duration: 0},
 * and `parseInt(...) || 0` flattened even a returned NULL to 0.
 *
 * Fix (pattern from #1611): plain AVG — NULL when unmeasured — a null
 * fallback row, and a parse that preserves null. The endpoint reports
 * avgDuration: null ("not measured"), never a measured-looking 0.
 * A measured average passes through unchanged (truncated to int by
 * the ::int cast, as before).
 *
 * Mock note (per the #1611/#1584 admin pattern): only module boundaries
 * are stubbed; the fake DB reproduces the exact Postgres semantics of
 * the expression under test — AVG of the seeded durations, NULL when
 * none exist, and a wrapping COALESCE(AVG(...), 0), if present in the
 * SQL the handler actually sends, converting that NULL to 0. Express
 * routing and the handler run for real. The Quinn HL-003 gate (real PG,
 * real HTTP) provides the fresh-install proof.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const role = req.headers['x-test-role'];
		if (!role) return res.status(401).json({ error: 'Authentication required' });
		req.user = { id: 1, role, company_id: null };
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
	getStats: jest.fn(async () => ({ pending: 0, sent: 0, failed: 0 })),
	retryFailed: jest.fn(async () => []),
}));

const pool = require('../../../lib/db');
const adminRoutes = require('../../../routes/admin');

function sessionStub(req, _res, next) {
	if (req.headers['x-test-admin-session'] === 'valid') {
		req.session = {
			isAdmin: true,
			adminLoginAt: new Date().toISOString(),
			lastAdminActivity: new Date().toISOString(),
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
	return app;
}

function adminGet(path) {
	return request(makeApp())
		.get(path)
		.set('x-test-role', 'admin')
		.set('x-test-admin-session', 'valid');
}

// Durations (seconds) of completed agent runs in the fake agent_data.
let seededDurations = [];

beforeAll(() => {
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
beforeEach(() => {
	pool.query.mockReset();
	pool.query.mockImplementation(async (sql) => {
		const q = String(sql);
		if (/AVG\(EXTRACT\(EPOCH/.test(q)) {
			const avg = seededDurations.length
				? seededDurations.reduce((a, b) => a + b, 0) / seededDurations.length
				: null;
			// Postgres: COALESCE(AVG(...), 0) converts the unmeasured NULL to 0.
			const coalesced = /COALESCE\(\s*AVG\(EXTRACT/.test(q);
			return {
				rows: [
					{
						avg_duration:
							avg === null ? (coalesced ? 0 : null) : Math.trunc(avg),
					},
				],
			};
		}
		if (/COUNT\(\*\) FILTER/.test(q)) return { rows: [{ completed: 0, total: 0 }] };
		return { rows: [{ count: 0 }] };
	});
});

describe('#1625 GET /admin/agents/stats avg_duration honesty', () => {
	test('no completed runs → avgDuration is null, not a fabricated 0', async () => {
		seededDurations = [];
		const res = await adminGet('/api/admin/agents/stats');
		expect(res.status).toBe(200);
		expect(res.body.data.stats.avgDuration).toBeNull();
	});

	test('measured durations → real average returned (100, 200 → 150)', async () => {
		seededDurations = [100, 200];
		const res = await adminGet('/api/admin/agents/stats');
		expect(res.status).toBe(200);
		expect(res.body.data.stats.avgDuration).toBe(150);
	});

	test('a genuinely measured sub-second average truncates to 0 and stays 0 (measured, not fabricated)', async () => {
		seededDurations = [0, 0];
		const res = await adminGet('/api/admin/agents/stats');
		expect(res.status).toBe(200);
		expect(res.body.data.stats.avgDuration).toBe(0);
	});
});
