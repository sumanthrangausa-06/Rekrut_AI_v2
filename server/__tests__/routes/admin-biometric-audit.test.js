/**
 * S-065 (#715): Biometric audit log read endpoint + viewer.
 *
 * AC-1: GET /api/admin/biometric-audit returns paginated audit entries
 *       (admin/hiring_manager only, main-app auth pattern).
 * AC-2: Filters — candidate_id, action, data_type, date range.
 * AC-3: Entries show pseudonymized candidate refs (display-level; no raw
 *       candidate_id in response, no PII joins in the read path).
 *
 * RED phase: routes/admin.js has no /biometric-audit route yet.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass (main-app pattern) ──────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const role = req.headers['x-test-role'];
		if (!role) return res.status(401).json({ error: 'Authentication required' });
		req.user = { id: 1, role };
		return next();
	});
	const requireRole = (...roles) => (req, res, next) => {
		if (!req.user) return res.status(401).json({ error: 'Authentication required' });
		if (!roles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}
		return next();
	};
	return { authMiddleware, requireRole, verifyToken: () => null };
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

const pool = require('../../../lib/db');
const adminRoutes = require('../../../routes/admin');

function makeApp() {
	const app = express();
	app.use(express.json());
	// Mount only the biometric-audit route to keep the test focused.
	// routes/admin mounts at /api/admin in server.js.
	app.use('/api/admin', adminRoutes);
	return app;
}

const SAMPLE_ROW = {
	id: 1,
	accessed_at: new Date('2026-10-01T10:00:00Z'),
	user_id: 5,
	user_role: 'recruiter',
	action: 'view',
	data_type: 'face_embedding',
	candidate_id: 42,
	ip_address: '1.2.3.4',
};

describe('GET /api/admin/biometric-audit', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockImplementation(async (sql) => {
			if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: '1' }] };
			return { rows: [SAMPLE_ROW] };
		});
	});

	test('401 without authentication', async () => {
		const res = await request(makeApp()).get('/api/admin/biometric-audit');
		expect(res.status).toBe(401);
	});

	test('403 for candidate role', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(403);
	});

	test('403 for recruiter role (not in allowed list)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'recruiter');
		expect(res.status).toBe(403);
	});

	test('200 for admin role', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('200 for hiring_manager role (main-app pattern)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'hiring_manager');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('returns paginated entries with total', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit?limit=10&offset=0')
			.set('x-test-role', 'admin');
		expect(res.body.entries).toHaveLength(1);
		expect(res.body.total).toBe(1);
		expect(res.body.limit).toBe(10);
		expect(res.body.offset).toBe(0);
	});

	test('caps limit at 200', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit?limit=9999')
			.set('x-test-role', 'admin');
		expect(res.body.limit).toBe(200);
	});

	test('AC-3: response has pseudonymized candidate_ref, no raw candidate_id', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		const entry = res.body.entries[0];
		expect(entry.candidate_ref).toMatch(/^CAND-[0-9a-f]{16}$/);
		expect(entry).not.toHaveProperty('candidate_id');
	});

	test('AC-3: pseudonym is stable for the same candidate', async () => {
		pool.query.mockImplementation(async (sql) => {
			if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: '2' }] };
			return { rows: [SAMPLE_ROW, { ...SAMPLE_ROW, id: 2 }] };
		});
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		expect(res.body.entries[0].candidate_ref).toBe(res.body.entries[1].candidate_ref);
	});

	test('AC-3: different candidates get different refs', async () => {
		pool.query.mockImplementation(async (sql) => {
			if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: '2' }] };
			return { rows: [SAMPLE_ROW, { ...SAMPLE_ROW, id: 2, candidate_id: 99 }] };
		});
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		expect(res.body.entries[0].candidate_ref).not.toBe(res.body.entries[1].candidate_ref);
	});

	test('AC-2: filters by action', async () => {
		await request(makeApp())
			.get('/api/admin/biometric-audit?action=view')
			.set('x-test-role', 'admin');
		const dataQuery = pool.query.mock.calls.find(([sql]) => /biometric_audit_log/i.test(sql) && !/COUNT/i.test(sql));
		expect(dataQuery[0]).toMatch(/action = \$/);
		expect(dataQuery[1]).toContain('view');
	});

	test('AC-2: filters by candidate_id', async () => {
		await request(makeApp())
			.get('/api/admin/biometric-audit?candidate_id=42')
			.set('x-test-role', 'admin');
		const dataQuery = pool.query.mock.calls.find(([sql]) => /biometric_audit_log/i.test(sql) && !/COUNT/i.test(sql));
		expect(dataQuery[0]).toMatch(/candidate_id = \$/);
		expect(dataQuery[1]).toContain(42);
	});

	test('AC-2: filters by date range', async () => {
		await request(makeApp())
			.get('/api/admin/biometric-audit?start_date=2026-09-01&end_date=2026-10-01')
			.set('x-test-role', 'admin');
		const dataQuery = pool.query.mock.calls.find(([sql]) => /biometric_audit_log/i.test(sql) && !/COUNT/i.test(sql));
		expect(dataQuery[0]).toMatch(/accessed_at >= \$/);
		expect(dataQuery[0]).toMatch(/accessed_at <= \$/);
	});

	test('AC-2: filters by data_type', async () => {
		await request(makeApp())
			.get('/api/admin/biometric-audit?data_type=face_embedding')
			.set('x-test-role', 'admin');
		const dataQuery = pool.query.mock.calls.find(([sql]) => /biometric_audit_log/i.test(sql) && !/COUNT/i.test(sql));
		expect(dataQuery[0]).toMatch(/data_type = \$/);
	});

	test('400 for invalid action filter', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit?action=bogus')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(400);
	});

	test('H2: 400 for non-numeric candidate_id filter', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit?candidate_id=abc')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(400);
	});

	test('L2: 400 for invalid date format', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit?start_date=not-a-date')
			.set('x-test-role', 'admin');
		expect(res.status).toBe(400);
	});

	test('M1: admin sees ip_address, hiring_manager does not', async () => {
		const adminRes = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		expect(adminRes.body.entries[0]).toHaveProperty('ip_address');

		const hmRes = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'hiring_manager');
		expect(hmRes.body.entries[0]).not.toHaveProperty('ip_address');
	});

	test('M2: viewer access is logged to audit_logs', async () => {
		await request(makeApp())
			.get('/api/admin/biometric-audit?action=view')
			.set('x-test-role', 'admin');
		// Allow the fire-and-forget insert to run
		await new Promise((r) => setImmediate(r));
		const logCall = pool.query.mock.calls.find(([sql]) =>
			/INSERT INTO audit_logs/i.test(sql),
		);
		expect(logCall).toBeDefined();
		expect(logCall[0]).toMatch(/biometric_audit_viewed/);
	});

	test('entry shape has no PII (no names, no emails)', async () => {
		const res = await request(makeApp())
			.get('/api/admin/biometric-audit')
			.set('x-test-role', 'admin');
		const entry = res.body.entries[0];
		expect(entry).not.toHaveProperty('name');
		expect(entry).not.toHaveProperty('email');
		expect(entry).not.toHaveProperty('candidate_name');
		// user_id is the actor's ID (needed for accountability), not PII by itself
		expect(entry).toHaveProperty('user_id');
		expect(entry).toHaveProperty('user_role');
		expect(entry).toHaveProperty('action');
		expect(entry).toHaveProperty('data_type');
		expect(entry).toHaveProperty('accessed_at');
	});
});
