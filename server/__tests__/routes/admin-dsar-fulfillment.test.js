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
	// #1456: routes/admin.js calls hashPassword at module load
	// (initAdminCredentials, admin.js:96) — mock must match the real
	// lib/auth export surface, mirroring admin-session-401-1224.
	hashPassword: jest.fn(async () => 'hash'),
}));

// ─── External boundaries ─────────────────────────────────────────────────────
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
	deleteErasedStorageFiles: jest.fn().mockResolvedValue({ deleted: 0, failed: 0, failures: [] }),
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
			jobApplicationsRedacted: true, // #780 §4
			jobApplicationRowsHeld: 0, // #780 §4
			screeningResponsesDeleted: true, // #813 §4
			jobApplicationScreeningsDeleted: false, // #813 §4
			aiScreeningsDeleted: true, // #813 §4
			outreachAttemptsDeleted: false, // #813 §4
			autoApplyProfileDeleted: true, // #813 §4
			aiScreeningAuditLogsDeleted: 2, // #813 D-1
			aiScreeningHumanReviewsDeleted: 1, // #813 D-1
			applicationKeyedRowsHeld: 0, // #813 §4
			applicationKeyedHeldDetails: [], // #813 D-3
			autoApplyConsentTombstone: { profileExisted: true, gdprConsent: true, consentDate: '2026-01-02T00:00:00.000Z' }, // #813 D-2
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

	test('#1128 D-8b: audit metadata AND response carry ONLY the sanitised erasure copy (counts, no raw keys)', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);
		const KEY = '/api/files/r2/cv/top-secret.pdf';
		const NP = 'https://storage.example.com/bucket/non-pattern-secret.pdf';
		erasePersonalData.mockResolvedValueOnce({
			shredded: true,
			storageKeys: [KEY],
			gapC: { scheduledInterviews: 1, nonPatternStorageUrls: [NP] },
			gapD: { offersRedacted: 2, nonPatternStorageUrls: [KEY, NP] },
		});

		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		const auditCall = client.query.mock.calls.find(([sql]) => /INSERT INTO audit_logs/.test(sql));
		const auditMeta = JSON.parse(auditCall[1][4]);
		expect(auditMeta.erasure.storageKeys).toBeUndefined();
		expect(auditMeta.erasure.storageKeysCount).toBe(1);
		expect(auditMeta.erasure.gapC.nonPatternStorageUrls).toBeUndefined();
		expect(auditMeta.erasure.gapC.nonPatternStorageUrlCount).toBe(1);
		expect(auditMeta.erasure.gapD.nonPatternStorageUrlCount).toBe(2);
		expect(auditCall[1][4]).not.toContain(KEY);
		expect(auditCall[1][4]).not.toContain(NP);
		expect(JSON.stringify(res.body)).not.toContain(KEY);
		expect(JSON.stringify(res.body)).not.toContain(NP);
		expect(res.body.erasure.storageKeysCount).toBe(1);
		expect(res.body.erasure.storageFilesDeleted).toBe(0);
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
			jobApplicationsRedacted: true, // #780 §4
			jobApplicationRowsHeld: 0, // #780 §4
			screeningResponsesDeleted: true, // #813 §4
			jobApplicationScreeningsDeleted: false, // #813 §4
			aiScreeningsDeleted: true, // #813 §4
			outreachAttemptsDeleted: false, // #813 §4
			autoApplyProfileDeleted: true, // #813 §4
			aiScreeningAuditLogsDeleted: 2, // #813 D-1
			aiScreeningHumanReviewsDeleted: 1, // #813 D-1
			applicationKeyedRowsHeld: 0, // #813 §4
			applicationKeyedHeldDetails: [], // #813 D-3
			autoApplyConsentTombstone: { profileExisted: true, gdprConsent: true, consentDate: '2026-01-02T00:00:00.000Z' }, // #813 D-2
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

	// #1116: the human-readable fulfilment note must disclose held
	// job-application rows — the structured audit metadata already carries
	// jobApplicationRowsHeld, but the note named only shredded/embeddings/
	// searchIndex, reading as a plain complete fulfilment.
	test('#1116: note discloses held job-application rows when jobApplicationRowsHeld > 0', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);
		erasePersonalData.mockResolvedValueOnce({
			shredded: true,
			embeddingsDeleted: true,
			searchIndexDeleted: false,
			jobApplicationsRedacted: false,
			jobApplicationRowsHeld: 2,
		});

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		const updateCall = client.query.mock.calls.find(([sql]) =>
			/UPDATE data_requests[\s\S]*SET/.test(sql),
		);
		expect(updateCall[1][1]).toMatch(/2 job application row\(s\) retained under legal hold/i);
	});

	// #1500: the fulfilment note must disclose held survivals AS A CLASS —
	// every held count > 0 on the erasure result, count + family label only.
	describe('#1500: held-survivals class disclosure', () => {
		const BASE_ERASURE = {
			shredded: true,
			embeddingsDeleted: true,
			searchIndexDeleted: false,
			jobApplicationRowsHeld: 0,
		};

		async function fulfilNote(erasure) {
			pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
			const client = mockClient();
			pool.connect.mockResolvedValueOnce(client);
			erasePersonalData.mockResolvedValueOnce({ ...BASE_ERASURE, ...erasure });
			await request(makeApp())
				.post('/api/admin/compliance/data-requests/10/fulfill')
				.expect(200);
			const updateCall = client.query.mock.calls.find(([sql]) =>
				/UPDATE data_requests[\s\S]*SET/.test(sql),
			);
			return updateCall[1][1];
		}

		test('discloses applicationKeyedRowsHeld > 0', async () => {
			const notes = await fulfilNote({ applicationKeyedRowsHeld: 3 });
			expect(notes).toMatch(/; 3 application-keyed row\(s\) retained under legal hold/);
		});

		test('discloses threatIntelRowsHeld > 0', async () => {
			const notes = await fulfilNote({ threatIntelRowsHeld: 2 });
			expect(notes).toMatch(/; 2 threat-intel row\(s\) retained under legal hold/);
		});

		test('discloses applicationIpRowsHeld > 0', async () => {
			const notes = await fulfilNote({ applicationIpRowsHeld: 4 });
			expect(notes).toMatch(/; 4 application IP capture row\(s\) retained under legal hold/);
		});

		test('discloses sessionsHeld > 0 (GAP-A)', async () => {
			const notes = await fulfilNote({ sessionsHeld: 1 });
			expect(notes).toMatch(/; 1 interview session row\(s\) retained under legal hold/);
		});

		test('discloses recordingsHeld > 0 (GAP-A)', async () => {
			const notes = await fulfilNote({ recordingsHeld: 2 });
			expect(notes).toMatch(/; 2 interview recording row\(s\) retained under legal hold/);
		});

		test('discloses framesHeld > 0 (GAP-A)', async () => {
			const notes = await fulfilNote({ framesHeld: 5 });
			expect(notes).toMatch(/; 5 recording frame row\(s\) retained under legal hold/);
		});

		test.each([
			['gapB', 'GAP-B'],
			['gapC', 'GAP-C'],
			['gapD', 'GAP-D'],
			['gapE', 'GAP-E'],
			['gapF', 'GAP-F'],
			['gapG', 'GAP-G'],
			['gapH', 'GAP-H'],
		])('discloses %s.rowsHeld > 0 as family %s', async (key, label) => {
			const notes = await fulfilNote({ [key]: { rowsHeld: 2 } });
			expect(notes).toMatch(
				new RegExp(`; 2 held row\\(s\\) in erasure family ${label} retained under legal hold`),
			);
		});

		test('combined: several families > 0 — all segments present, order stable, job-application segment first and unchanged', async () => {
			const notes = await fulfilNote({
				jobApplicationRowsHeld: 2,
				applicationKeyedRowsHeld: 3,
				sessionsHeld: 1,
				framesHeld: 5,
				gapC: { rowsHeld: 4 },
				gapH: { rowsHeld: 6 },
			});
			const segments = [
				'; 2 job application row(s) retained under legal hold',
				'; 3 application-keyed row(s) retained under legal hold',
				'; 1 interview session row(s) retained under legal hold',
				'; 5 recording frame row(s) retained under legal hold',
				'; 4 held row(s) in erasure family GAP-C retained under legal hold',
				'; 6 held row(s) in erasure family GAP-H retained under legal hold',
			];
			let lastIndex = -1;
			for (const segment of segments) {
				const idx = notes.indexOf(segment);
				expect(idx).toBeGreaterThan(lastIndex);
				lastIndex = idx;
			}
			// Families at 0/absent contribute no segment.
			expect(notes).not.toMatch(/threat-intel/);
			expect(notes).not.toMatch(/GAP-B/);
		});

		test('privacy: note contains NO held-detail strings (applicationKeyedHeldDetails ids/reasons, gap heldTables names)', async () => {
			const notes = await fulfilNote({
				applicationKeyedRowsHeld: 1,
				applicationKeyedHeldDetails: [
					{ applicationId: 'SENTINEL-APP-ID-1500', reason: 'SENTINEL-HOLD-REASON-1500', companyId: 'SENTINEL-COMPANY-1500' },
				],
				gapB: { rowsHeld: 1, heldTables: ['SENTINEL_TABLE_B_1500'] },
				gapD: { rowsHeld: 1, heldTables: ['SENTINEL_TABLE_D_1500'] },
			});
			expect(notes).toMatch(/; 1 application-keyed row\(s\) retained under legal hold/);
			expect(notes).toMatch(/GAP-B/);
			expect(notes).toMatch(/GAP-D/);
			expect(notes).not.toContain('SENTINEL-APP-ID-1500');
			expect(notes).not.toContain('SENTINEL-HOLD-REASON-1500');
			expect(notes).not.toContain('SENTINEL-COMPANY-1500');
			expect(notes).not.toContain('SENTINEL_TABLE_B_1500');
			expect(notes).not.toContain('SENTINEL_TABLE_D_1500');
		});

		test('all-zero/absent: note is byte-identical to the pre-#1500 format', async () => {
			const notes = await fulfilNote({
				applicationKeyedRowsHeld: 0,
				threatIntelRowsHeld: 0,
				applicationIpRowsHeld: 0,
				sessionsHeld: 0,
				recordingsHeld: 0,
				framesHeld: 0,
				gapB: { rowsHeld: 0 },
				gapC: { rowsHeld: 0 },
				gapD: { rowsHeld: 0 },
				gapE: { rowsHeld: 0 },
				gapF: { rowsHeld: 0 },
				gapG: { rowsHeld: 0 },
				gapH: { rowsHeld: 0 },
			});
			expect(notes).toBe(
				'Awaiting compliance review\nFulfilled by admin: DEK shredded=true, embeddings=true, searchIndex=false',
			);
		});
	});

	test('#1116: note unchanged (no held-rows disclosure) when jobApplicationRowsHeld is 0', async () => {
		pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
		const client = mockClient();
		pool.connect.mockResolvedValueOnce(client);
		erasePersonalData.mockResolvedValueOnce({
			shredded: true,
			embeddingsDeleted: true,
			searchIndexDeleted: false,
			jobApplicationsRedacted: true,
			jobApplicationRowsHeld: 0,
		});

		await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(200);

		const updateCall = client.query.mock.calls.find(([sql]) =>
			/UPDATE data_requests[\s\S]*SET/.test(sql),
		);
		expect(updateCall[1][1]).toMatch(/Fulfilled by admin: DEK shredded=true/);
		expect(updateCall[1][1]).not.toMatch(/retained under legal hold/i);
	});
});
