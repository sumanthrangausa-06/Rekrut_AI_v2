/**
 * #746: DSAR fulfillment endpoint — POST /api/admin/compliance/data-requests/:id/fulfill
 *
 * Admin-only endpoint to fulfill pending DSAR deletion requests by calling the
 * shared erasureService.erasePersonalData() (S-067/S-075), so admin fulfillment
 * shreds identically to self-serve account deletion.
 *
 * RED tests:
 * - pending deletion request → erasePersonalData called in tx, row → 'completed'
 * - request_type != 'deletion' → 400 (type gate; exports are fulfilled at creation)
 * - already 'completed' → 200 idempotent, no erasure call
 * - 'rejected' → 409
 * - NULL user_id (user row already deleted) → completes without erasure
 * - erasure throws → 500, ROLLBACK issued, row not marked completed
 * - non-admin → 401 (requireAdmin convention, same as the listing endpoint)
 * - unknown id → 404
 * - non-numeric id → 400
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass (S-065 pattern) ─────────────────────────────────────────────
jest.mock('../../../lib/auth', () => ({
	verifyToken: jest.fn(() => null),
	authMiddleware: jest.fn((_req, _res, next) => next()),
	requireRole: () => (_req, _res, next) => next(),
}));

// ─── External boundaries ─────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn() },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, admin: passthrough },
		distributedRateLimiter: { checkLimit: jest.fn() },
	};
});
jest.mock('../../../lib/activity-logger', () => ({ logAuthEvent: jest.fn() }));

const pool = require('../../../lib/db');
const { erasePersonalData } = require('../../../lib/erasureService');
const { AuditLogger } = require('../../../services/auditLogService');
const adminRoutes = require('../../../routes/admin');

function makeApp({ admin = true, userId = 99 } = {}) {
	const app = express();
	app.use(express.json());
	// Test session injection — exercises requireAdmin Path 1 (session admin).
	app.use((req, _res, next) => {
		req.session = {};
		if (admin) {
			req.session = {
				isAdmin: true,
				lastAdminActivity: new Date().toISOString(),
				adminLoginAt: new Date().toISOString(),
			};
			req.user = { id: userId, role: 'admin' };
		}
		next();
	});
	app.use('/api/admin', adminRoutes);
	return app;
}

const PENDING_DELETION = {
	id: 10,
	user_id: 7,
	request_type: 'deletion',
	status: 'pending',
	requested_at: new Date('2026-10-01T10:00:00Z'),
	processed_at: null,
	processed_by: null,
	export_url: null,
	notes: 'Awaiting compliance review',
	metadata: {},
	company_id: 3,
};

function mockClient() {
	return { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
}

describe('POST /api/admin/compliance/data-requests/:id/fulfill', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('fulfills a pending deletion request: erases in tx, marks completed, audits', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);
		erasePersonalData.mockResolvedValueOnce({
			shredded: true,
			embeddingsDeleted: true,
			searchIndexDeleted: false,
		});

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		expect(res.body.success).toBe(true);
		expect(res.body.status).toBe('completed');

		// Erasure runs inside the transaction with the shared routine.
		expect(erasePersonalData).toHaveBeenCalledTimes(1);
		expect(erasePersonalData).toHaveBeenCalledWith(
			7,
			expect.objectContaining({
				client,
				audit: expect.objectContaining({ userId: 7, companyId: 3 }),
			}),
		);

		// Transaction: BEGIN → UPDATE → COMMIT, released.
		const statements = client.query.mock.calls.map(([sql]) => sql);
		expect(statements[0]).toBe('BEGIN');
		expect(
			statements.some((s) => /UPDATE data_requests[\s\S]*SET[\s\S]*status = 'completed'/.test(s)),
		).toBe(true);
		expect(statements).toContain('COMMIT');
		expect(statements).not.toContain('ROLLBACK');
		expect(client.release).toHaveBeenCalled();

		// Update stamps processed_by with the admin.
		const updateCall = client.query.mock.calls.find(([sql]) =>
			/UPDATE data_requests[\s\S]*SET/.test(sql),
		);
		expect(updateCall[1][0]).toBe(99); // processed_by = admin user id

		// Audit entry written atomically inside the tx (same audit_logs schema
		// as AuditLogger.log) — with the admin's identity recorded.
		const auditCall = client.query.mock.calls.find(([sql]) =>
			/INSERT INTO audit_logs/.test(sql),
		);
		expect(auditCall).toBeDefined();
		expect(auditCall[1][0]).toBe('gdpr_deletion_fulfilled'); // action_type
		expect(auditCall[1][1]).toBe(99); // user_id = admin
		expect(auditCall[1][2]).toBe('data_request'); // target_type
		expect(auditCall[1][3]).toBe(10); // target_id
		const auditMeta = JSON.parse(auditCall[1][4]);
		expect(auditMeta.target_user_id).toBe(7);
		expect(auditMeta.fulfilledBy).toBeDefined();
	});

	test('rejects non-deletion request types (export is fulfilled at creation)', async () => {
		pool.query.mockResolvedValueOnce({
			rows: [{ ...PENDING_DELETION, request_type: 'export', status: 'completed' }],
		});

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(400);

		expect(res.body.error).toMatch(/export/i);
		expect(erasePersonalData).not.toHaveBeenCalled();
		expect(pool.connect).not.toHaveBeenCalled();
	});

	test('already-completed request is idempotent: no re-erasure', async () => {
		pool.query.mockResolvedValueOnce({
			rows: [{ ...PENDING_DELETION, status: 'completed', processed_at: new Date() }],
		});

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		expect(res.body.success).toBe(true);
		expect(res.body.alreadyProcessed).toBe(true);
		expect(erasePersonalData).not.toHaveBeenCalled();
		expect(pool.connect).not.toHaveBeenCalled();
	});

	test('rejected request cannot be fulfilled', async () => {
		pool.query.mockResolvedValueOnce({
			rows: [{ ...PENDING_DELETION, status: 'rejected' }],
		});

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(409);

		expect(erasePersonalData).not.toHaveBeenCalled();
	});

	test('NULL user_id (user row already deleted) completes without erasure', async () => {
		pool.query.mockResolvedValueOnce({
			rows: [{ ...PENDING_DELETION, user_id: null, company_id: null }],
		});
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		expect(res.body.success).toBe(true);
		expect(res.body.status).toBe('completed');
		expect(erasePersonalData).not.toHaveBeenCalled();
		// Still stamps completed + notes; transaction commits.
		const statements = client.query.mock.calls.map(([sql]) => sql);
		expect(statements).toContain('COMMIT');
		const updateCall = client.query.mock.calls.find(([sql]) =>
			/UPDATE data_requests[\s\S]*SET/.test(sql),
		);
		expect(updateCall[1][1]).toMatch(/anomaly|out-of-band/i);
	});

	test('erasure failure → 500, ROLLBACK, row not marked completed', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);
		erasePersonalData.mockRejectedValueOnce(new Error('DEK store unreachable'));

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(500);

		const statements = client.query.mock.calls.map(([sql]) => sql);
		expect(statements).toContain('ROLLBACK');
		expect(statements).not.toContain('COMMIT');
		expect(client.release).toHaveBeenCalled();
	});

	test('audit INSERT failure → 500, ROLLBACK (fail-closed: no silent audit loss)', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = {
			query: jest.fn(async (sql) => {
				if (/INSERT INTO audit_logs/.test(sql)) {
					throw new Error('audit_logs unavailable');
				}
				return { rowCount: 1 };
			}),
			release: jest.fn(),
		};
		pool.connect.mockResolvedValueOnce(client);
		erasePersonalData.mockResolvedValueOnce({
			shredded: true,
			embeddingsDeleted: true,
			searchIndexDeleted: false,
		});

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(500);

		const statements = client.query.mock.calls.map(([sql]) => sql);
		expect(statements).toContain('ROLLBACK');
		expect(statements).not.toContain('COMMIT');
		expect(client.release).toHaveBeenCalled();
	});

	test('non-admin is denied (requireAdmin convention)', async () => {
		await request(makeApp({ admin: false }))
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(401);

		expect(erasePersonalData).not.toHaveBeenCalled();
	});

	test('unknown request id → 404', async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/999/fulfill')
			.expect(404);
	});

	test('non-numeric id → 400', async () => {
		await request(makeApp())
			.post('/api/admin/compliance/data-requests/abc/fulfill')
			.expect(400);

		expect(pool.query).not.toHaveBeenCalled();
	});
});
