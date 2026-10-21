/**
 * #1526 (Story E, #1152 repoint programme) — admin stats R9 + R10.
 *
 * Rex scale decision 2026-10-20 §3/§4:
 * - R9 transparency report: a number presented AS an OmniScore is native
 *   300-850 pass-through. `AVG(total_score)` / `COUNT(total_score)` over
 *   `omni_scores` (COUNT(col) excludes NULL totals = no data), and the
 *   average of nothing is honest NULL, never `parseFloat(...) || 0`.
 * - R10 performance distribution: buckets are an index over scores, so
 *   convert ONCE at the SQL boundary: norm100 = (total_score - 300) / 5.5,
 *   bucket = FLOOR(norm100 / 10) * 10. Known anchor: total 612 -> norm 56.7
 *   -> bucket 50. The 30-day window is re-based on `omni_scores.last_updated`
 *   (stamped on every score calculation), NOT `created_at` (row creation,
 *   when the score is still NULL).
 * - The dead `omniscore_results` table (zero writers) must not be read.
 *
 * DB mock routes SQL text to canned pg-shaped rows (AVG arrives as a
 * string, COUNT as a string, like real pg numeric/bigint).
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

const queries = [];
let omniAvgRow = { avg_score: '612.00', total_scores: '2' };
let scoreDistRows = [{ bucket: '50', count: '3' }];

function routeQueries(sql) {
	queries.push(sql);
	if (/FROM omni_scores/i.test(sql) && /AVG\(/i.test(sql)) return { rows: [omniAvgRow] };
	if (/FROM omni_scores/i.test(sql) && /FLOOR\(/i.test(sql)) return { rows: scoreDistRows };
	if (/FROM omniscore_results/i.test(sql)) {
		// Dead table on a fresh install: no rows / null aggregate.
		if (/AVG\(/i.test(sql)) return { rows: [{ avg_score: null, total_scores: '0' }] };
		return { rows: [] };
	}
	if (/FROM system_settings/i.test(sql)) return { rows: [] };
	if (/FROM score_appeals/i.test(sql)) return { rows: [{ total: '0', resolved: '0' }] };
	if (/FROM fairness_audits/i.test(sql)) return { rows: [] };
	if (/FROM bias_reports/i.test(sql)) return { rows: [] };
	if (/FROM consent_records/i.test(sql)) return { rows: [{ total: '0' }] };
	if (/FROM data_retention_policies/i.test(sql)) return { rows: [] };
	if (/FROM audit_logs/i.test(sql)) {
		if (/total_decisions/i.test(sql)) return { rows: [{ total_decisions: '0', reviewed_count: null }] };
		if (/metadata->>'model'/i.test(sql)) return { rows: [] };
		if (/DATE\(created_at\)/i.test(sql)) return { rows: [] };
		return { rows: [{ total: '0' }] };
	}
	return { rows: [] };
}

beforeEach(() => {
	jest.clearAllMocks();
	queries.length = 0;
	omniAvgRow = { avg_score: '612.00', total_scores: '2' };
	scoreDistRows = [{ bucket: '50', count: '3' }];
	pool.query.mockImplementation(async (sql) => routeQueries(sql));
});

const ADMIN = { 'x-test-admin-session': 'valid' };

describe('R9 — GET /compliance/transparency-report performanceMetrics', () => {
	test('sources avg/count from omni_scores total_score, never omniscore_results', async () => {
		const res = await request(makeApp())
			.get('/api/admin/compliance/transparency-report')
			.set(ADMIN);
		expect(res.status).toBe(200);
		const omniSql = queries.find((q) => /AVG\(/i.test(q));
		expect(omniSql).toBeDefined();
		expect(omniSql).toMatch(/AVG\(total_score\)/i);
		expect(omniSql).toMatch(/COUNT\(total_score\)/i);
		expect(omniSql).toMatch(/FROM omni_scores/i);
		expect(queries.some((q) => /omniscore_results/i.test(q))).toBe(false);
	});

	test('avgOmniScore is the native 300-850 average of the known dataset', async () => {
		const res = await request(makeApp())
			.get('/api/admin/compliance/transparency-report')
			.set(ADMIN);
		expect(res.status).toBe(200);
		expect(res.body.performanceMetrics.avgOmniScore).toBe(612);
		expect(res.body.performanceMetrics.totalScores).toBe(2);
	});

	test('no scores -> avgOmniScore is honest null (not 0), totalScores 0', async () => {
		omniAvgRow = { avg_score: null, total_scores: '0' };
		const res = await request(makeApp())
			.get('/api/admin/compliance/transparency-report')
			.set(ADMIN);
		expect(res.status).toBe(200);
		expect(res.body.performanceMetrics.avgOmniScore).toBeNull();
		expect(res.body.performanceMetrics.totalScores).toBe(0);
	});
});

describe('R10 — GET /compliance/performance scoreDistribution', () => {
	test('buckets use the Rex conversion over omni_scores, windowed on last_updated', async () => {
		const res = await request(makeApp()).get('/api/admin/compliance/performance').set(ADMIN);
		expect(res.status).toBe(200);
		const distSql = queries.find((q) => /FLOOR\(/i.test(q));
		expect(distSql).toBeDefined();
		expect(distSql).toMatch(/FROM omni_scores/i);
		expect(distSql).toMatch(/total_score\s*-\s*300/i);
		expect(distSql).toMatch(/5\.5/);
		expect(distSql).toMatch(/total_score IS NOT NULL/i);
		expect(distSql).toMatch(/last_updated\s*>=/i);
		expect(queries.some((q) => /omniscore_results/i.test(q))).toBe(false);
	});

	test('known total 612 (norm 56.7) lands in bucket 50, label shape unchanged', async () => {
		const res = await request(makeApp()).get('/api/admin/compliance/performance').set(ADMIN);
		expect(res.status).toBe(200);
		expect(res.body.modelPerformance.scoreDistribution).toEqual([{ bucket: 50, count: 3 }]);
	});
});
