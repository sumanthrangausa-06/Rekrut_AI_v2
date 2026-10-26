/**
 * #799 (G-1): legal-hold set/release API + DSAR-conflict mapping.
 *
 * - POST /api/admin/legal-holds        admin-only; place a hold (user and/or company)
 * - POST /api/admin/legal-holds/:id/release  admin-only; release it
 * - GET  /api/admin/legal-holds        admin-only; list
 * - DSAR fulfilment hitting an active hold → 409 (Art. 17(3)(e) conflict
 *   surfaced + recorded), never a silent partial erase, never a 500.
 *   Repo convention: requireAdmin rejects non-admins with 401 (same as
 *   the DSAR listing endpoint tests) — STOP 1's "403" is realised as the
 *   repo's existing admin-gate status.
 * #780 note: erasePersonalData is mocked at this module boundary, so
 * this suite carries no query-sequence chain to extend — the #780
 * job_applications SELECT/UPDATE steps and the §4 return additions
 * (jobApplicationsRedacted / jobApplicationRowsHeld) live inside the
 * mocked function and are covered by the lib suites
 * (job-applications-erasure, legal-hold). The LegalHoldError mapping
 * exercised here is unchanged by #780.
 *
 * #813 note: same module-boundary posture — the C2 sweep's five-table
 * SELECT/DELETE steps and its return additions (the five *Deleted
 * flags, aiScreeningAuditLogsDeleted / aiScreeningHumanReviewsDeleted
 * counts, applicationKeyedRowsHeld / applicationKeyedHeldDetails,
 * autoApplyConsentTombstone) live inside the mocked function and are
 * covered by the lib suite (application-keyed-erasure). Unchanged here.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	verifyToken: jest.fn(() => null),
	authMiddleware: jest.fn((_req, _res, next) => next()),
	requireRole: () => (_req, _res, next) => next(),
	// #1456: routes/admin.js calls hashPassword at module load
	// (initAdminCredentials, admin.js:96) — mock must match the real
	// lib/auth export surface, mirroring admin-session-401-1224.
	hashPassword: jest.fn(async () => 'hash'),
}));
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
	deleteErasedStorageFiles: jest.fn().mockResolvedValue({ deleted: 0, failed: 0, failures: [] }),
}));
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
		isHeld: jest.fn().mockResolvedValue(false),
		anyHoldActive: jest.fn().mockResolvedValue(false),
		placeHold: jest.fn(),
		releaseHold: jest.fn(),
		listHolds: jest.fn().mockResolvedValue([]),
		recordLegalHoldConflict: jest.fn().mockResolvedValue({}),
	};
});
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
const legalHold = require('../../../lib/legalHold');
const { erasePersonalData } = require('../../../lib/erasureService');
const adminRoutes = require('../../../routes/admin');

function makeApp({ admin = true } = {}) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.session = {};
		if (admin) {
			req.session = {
				isAdmin: true,
				lastAdminActivity: new Date().toISOString(),
				adminLoginAt: new Date().toISOString(),
			};
			req.user = { id: 99, role: 'admin' };
		}
		next();
	});
	app.use('/api/admin', adminRoutes);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	legalHold.listHolds.mockResolvedValue([]);
	legalHold.recordLegalHoldConflict.mockResolvedValue({});
});

describe('legal-hold admin API', () => {
	test('non-admin cannot place a hold (admin gate)', async () => {
		const res = await request(makeApp({ admin: false }))
			.post('/api/admin/legal-holds')
			.send({ userId: 7, reason: 'litigation' });
		expect(res.status).toBe(401);
		expect(legalHold.placeHold).not.toHaveBeenCalled();
	});

	test('admin places a user hold: 201, actor passed through', async () => {
		legalHold.placeHold.mockResolvedValue({ id: 5, user_id: 7, company_id: null, reason: 'litigation' });
		const res = await request(makeApp())
			.post('/api/admin/legal-holds')
			.send({ userId: 7, reason: 'litigation' });
		expect(res.status).toBe(201);
		expect(res.body.hold.id).toBe(5);
		expect(legalHold.placeHold).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 7, reason: 'litigation' }),
		);
		expect(legalHold.placeHold.mock.calls[0][0].setBy).toBeTruthy();
	});

	test('place rejects a subject-less hold with 400', async () => {
		const res = await request(makeApp()).post('/api/admin/legal-holds').send({ reason: 'x' });
		expect(res.status).toBe(400);
		expect(legalHold.placeHold).not.toHaveBeenCalled();
	});

	test('place rejects a reason-less hold with 400', async () => {
		const res = await request(makeApp()).post('/api/admin/legal-holds').send({ userId: 7 });
		expect(res.status).toBe(400);
		expect(legalHold.placeHold).not.toHaveBeenCalled();
	});

	test('#918: a non-existent subject is surfaced as 404 with the reason, never a silent success or a buried 500', async () => {
		const err = new Error('legalHold.placeHold: subject user 999 does not exist');
		err.code = 'SUBJECT_NOT_FOUND';
		err.status = 404;
		legalHold.placeHold.mockRejectedValue(err);
		const res = await request(makeApp())
			.post('/api/admin/legal-holds')
			.send({ userId: 999, reason: 'litigation' });
		expect(res.status).toBe(404);
		expect(res.body.error).toMatch(/user 999 does not exist/);
	});

	test('#1404: a non-integer subject id is surfaced as 400 with the reason, never a buried 500', async () => {
		const err = new Error('legalHold.placeHold: userId must be an integer id (received "abc")');
		err.code = 'INVALID_SUBJECT_ID';
		err.status = 400;
		legalHold.placeHold.mockRejectedValue(err);
		const res = await request(makeApp())
			.post('/api/admin/legal-holds')
			.send({ userId: 'abc', reason: 'litigation' });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/must be an integer/);
	});

	test('#1409: an out-of-int4-range company id is surfaced as 400 via the same INVALID_SUBJECT_ID mapping', async () => {
		const err = new Error('legalHold.placeHold: companyId must be an integer id (received 2147483648)');
		err.code = 'INVALID_SUBJECT_ID';
		err.status = 400;
		legalHold.placeHold.mockRejectedValue(err);
		const res = await request(makeApp())
			.post('/api/admin/legal-holds')
			.send({ companyId: 2147483648, reason: 'litigation' });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/must be an integer/);
	});

	test('#1416: an out-of-int4-range hold id is surfaced as 400 via the INVALID_HOLD_ID mapping, never a buried 500', async () => {
		const err = new Error('legalHold.releaseHold: holdId must be an integer id (received 2147483648)');
		err.code = 'INVALID_HOLD_ID';
		err.status = 400;
		legalHold.releaseHold.mockRejectedValue(err);
		const res = await request(makeApp()).post('/api/admin/legal-holds/2147483648/release').send({});
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/must be an integer/);
	});

	test('admin releases a hold: 200 with released row', async () => {
		legalHold.releaseHold.mockResolvedValue({ id: 5, released_at: new Date().toISOString(), released_by: 'x' });
		const res = await request(makeApp()).post('/api/admin/legal-holds/5/release').send({});
		expect(res.status).toBe(200);
		expect(legalHold.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ holdId: 5 }));
	});

	test('release of unknown hold → 404', async () => {
		legalHold.releaseHold.mockResolvedValue(null);
		const res = await request(makeApp()).post('/api/admin/legal-holds/999/release').send({});
		expect(res.status).toBe(404);
	});

	test('admin lists holds', async () => {
		legalHold.listHolds.mockResolvedValue([{ id: 5, user_id: 7 }]);
		const res = await request(makeApp()).get('/api/admin/legal-holds');
		expect(res.status).toBe(200);
		expect(res.body.holds).toHaveLength(1);
	});
});

describe('DSAR fulfilment vs legal hold → 409', () => {
	const PENDING_DELETION = {
		id: 10,
		user_id: 7,
		request_type: 'deletion',
		status: 'pending',
		notes: null,
		company_id: 3,
	};

	test('LegalHoldError from erasePersonalData maps to 409, tx rolled back, conflict recorded', async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [PENDING_DELETION] }) // data_requests lookup
			.mockResolvedValue({ rows: [], rowCount: 1 }); // conflict-record write
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
		pool.connect.mockResolvedValue(client);
		erasePersonalData.mockRejectedValue(new legalHold.LegalHoldError('held', { userId: 7 }));

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.send({});

		expect(res.status).toBe(409);
		expect(res.body.error).toMatch(/legal hold/i);
		const clientSql = client.query.mock.calls.map((c) => c[0]);
		expect(clientSql).toContain('ROLLBACK');
		expect(clientSql.some((s) => s.includes("status = 'completed'"))).toBe(false);
		// Conflict is recorded (notes/audit write via pool after rollback)
		const recorded = pool.query.mock.calls.some(
			(c) => /data_requests|audit_logs/.test(c[0]) && /legal hold/i.test(JSON.stringify(c[1] || [])),
		);
		expect(recorded).toBe(true);
	});

	test('Lex F-1: the conflict is written to the compliance audit trail with hold id, actor, and request/subject identifiers', async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [PENDING_DELETION] })
			.mockResolvedValue({ rows: [], rowCount: 1 });
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
		pool.connect.mockResolvedValue(client);
		erasePersonalData.mockRejectedValue(
			new legalHold.LegalHoldError('held', { userId: 7, holdId: 5 }),
		);

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.send({});

		expect(res.status).toBe(409);
		expect(res.body.error).toMatch(/has been recorded/);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledTimes(1);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledWith(
			expect.objectContaining({
				holdId: 5,
				requestId: 10,
				subjectUserId: 7,
				source: 'dsar_fulfillment',
			}),
		);
		const arg = legalHold.recordLegalHoldConflict.mock.calls[0][0];
		expect(arg.actor).toBeTruthy(); // the admin who attempted fulfilment
	});

	test('Lex F-1: if the audit-trail write FAILS, the response must not claim recording (fail closed, no 409)', async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [PENDING_DELETION] })
			.mockResolvedValue({ rows: [], rowCount: 1 });
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
		pool.connect.mockResolvedValue(client);
		erasePersonalData.mockRejectedValue(
			new legalHold.LegalHoldError('held', { userId: 7, holdId: 5 }),
		);
		legalHold.recordLegalHoldConflict.mockRejectedValue(new Error('audit trail down'));

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.send({});

		expect(res.status).toBe(500);
		expect(res.body.error).not.toMatch(/has been recorded/);
		expect(res.body.error).toMatch(/could not be recorded/i);
		const clientSql = client.query.mock.calls.map((c) => c[0]);
		expect(clientSql).toContain('ROLLBACK'); // erasure still did not proceed
	});
});
