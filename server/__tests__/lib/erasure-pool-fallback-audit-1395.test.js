/**
 * #1395: audit of the remaining pool fallbacks in lib/erasureService.js
 * (follow-up of the #1343 guard on erasePersonalData).
 *
 * AUDIT CONCLUSION (Lead/Nova, verified line-by-line on dev 9cbd62e22):
 * erasePersonalData is the ONLY exported eraser that relies on the
 * caller's transaction for fail-closed semantics — a mid-function throw
 * there must roll back the whole erasure, so #1343 rightly refuses the
 * autocommit pool. The functions pinned here were each designed for the
 * pool, and forcing the #1343 guard onto them would BREAK their only
 * production callers:
 *
 *  - deleteErasedStorageFiles: Phase 2 runs POST-COMMIT by design
 *    (routes/auth.js, routes/admin.js call it after COMMIT; R2 is NEVER
 *    in-tx). Its unit of correctness is the per-entry ledger row
 *    (pending -> deleted/failed), not a multi-statement transaction:
 *    deletes are idempotent, each entry's outcome is recorded on its
 *    own row, and un-drained rows stay 'pending' for the sweep.
 *    Partial progress is CORRECT progress here, never a wrong state.
 *  - sweepPendingStorageDeletions: the server.js retention-tick batch
 *    sweep; delegates per user to the drain above. A failure leaves
 *    rows 'pending' and the next tick resumes — crash recovery is the
 *    design, not an accident.
 *  - purgeDrainedStorageDeletions: SELF-transactional. The pool is its
 *    client factory (pool.connect()) plus read-only pre-pass; every
 *    write (fold INSERT + ledger DELETE) happens inside its own
 *    per-user BEGIN...COMMIT on a dedicated client, count-checked.
 *    No caller transaction is assumed or needed. REVIEW ROUND (#1395
 *    specialist HIGH): the contract was narrowed — a connect-less
 *    {query}-only queryable is now REFUSED with a typed
 *    ErasurePurgePoolRequiredError, because BEGIN on it would be
 *    non-sticky or would hijack a caller transaction (the #1343 void
 *    through the side door); connect() acquisition also moved inside
 *    the per-user containment. The sweep likewise gained per-user
 *    failure isolation (review MEDIUM). Those two behaviours are
 *    pinned below alongside the audit pins.
 *  - sanitizeErasureResult: pure function, no DB access at all
 *    (re-export of lib/erasureResultSanitizer).
 *
 * These tests PIN that contract: the no-client pool path is deliberate
 * and must keep working. If a future change makes any of these throw
 * ErasureTransactionRequiredError, these tests fail — that is the
 * guard-rail this issue adds instead of a code guard.
 *
 * Mocked evidence only here; the real-DB caller-path proof (fresh
 * install, real pool, state read back) is recorded in PR for #1395.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(async () => {}),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(async () => ({ deleted: true })),
	deleteStorageObject: jest.fn(async () => ({ deleted: true })),
	getProviders: jest.fn(() => [{ name: 'r2', bucket: 'test-bucket' }]),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
	decrypt: jest.fn((buf) => Buffer.from(buf)),
}));
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const { deleteFile } = require('../../../lib/file-storage');
const erasureService = require('../../../lib/erasureService');
const { sanitizeErasureResult: sanitizerFn } = require('../../../lib/erasureResultSanitizer');

beforeEach(() => {
	jest.clearAllMocks();
	deleteFile.mockImplementation(async () => ({ deleted: true }));
});

describe('#1395 export surface', () => {
	test('all audited exports present; sanitizeErasureResult is the pure sanitizer re-export', () => {
		expect(typeof erasureService.deleteErasedStorageFiles).toBe('function');
		expect(typeof erasureService.sweepPendingStorageDeletions).toBe('function');
		expect(typeof erasureService.purgeDrainedStorageDeletions).toBe('function');
		expect(erasureService.sanitizeErasureResult).toBe(sanitizerFn);
		expect(erasureService.STORAGE_DELETION_PURGE_GRACE_DAYS).toBe(7);
	});
});

describe('#1395 deleteErasedStorageFiles — deliberate post-commit pool drain (NO transaction guard)', () => {
	function routeDrain(entries, updates) {
		return jest.fn(async (sql, params = []) => {
			if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
			if (sql.includes('FROM pending_storage_deletions'))
				return { rows: entries, rowCount: entries.length };
			if (sql.includes('UPDATE pending_storage_deletions')) {
				updates.push({ status: params[0], id: params[2] });
				return { rows: [], rowCount: 1 };
			}
			return { rows: [], rowCount: 1 };
		});
	}

	test('called with NO client (the production post-commit shape) it drains via the pool and does NOT throw ERASURE_TRANSACTION_REQUIRED', async () => {
		const updates = [];
		db.query.mockImplementation(
			routeDrain(
				[{ id: 1, file_url: '/api/files/a%2Fb.txt', storage_type: 'r2', source_family: 'file' }],
				updates,
			),
		);
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res).toEqual({ deleted: 1, failed: 0, failures: [], heldSkips: 0 });
		expect(updates).toEqual([{ status: 'deleted', id: 1 }]);
	});

	test('per-entry autocommit is the contract: entry 1 commits as deleted even when entry 2 fails (no rollback assumed or wanted)', async () => {
		const updates = [];
		db.query.mockImplementation(
			routeDrain(
				[
					{ id: 1, file_url: '/api/files/ok.txt', storage_type: 'r2', source_family: 'file' },
					{ id: 2, file_url: '/api/files/bad.txt', storage_type: 'r2', source_family: 'file' },
				],
				updates,
			),
		);
		deleteFile
			.mockImplementationOnce(async () => ({ deleted: true }))
			.mockImplementationOnce(async () => ({ deleted: false, alreadyGone: false, reason: 'denied' }));
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(1);
		expect(res.failed).toBe(1);
		// BOTH outcomes are durably recorded on their own ledger rows —
		// under a caller transaction the first UPDATE would have rolled
		// back with the second's failure, resurrecting a deleted object
		// as 'pending'. That is precisely why this function must NOT be
		// forced into the #1343 shape.
		expect(updates).toEqual([
			{ status: 'deleted', id: 1 },
			{ status: 'failed', id: 2 },
		]);
	});
});

describe('#1395 sweepPendingStorageDeletions — deliberate batch sweep on the pool', () => {
	test('no-arg call (the server.js retention-tick shape) drains every pending user and sums totals', async () => {
		db.query.mockImplementation(async (sql, params = []) => {
			if (sql.includes('SELECT DISTINCT user_id FROM pending_storage_deletions'))
				return { rows: [{ user_id: 7 }, { user_id: 8 }], rowCount: 2 };
			if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
			if (sql.includes('FROM pending_storage_deletions'))
				// Per-user rows: the drain must be delegated with EACH
				// user_id (review LOW 5d — distinct row per user).
				return {
					rows: [
						{
							id: params[0],
							file_url: `/api/files/u${params[0]}.txt`,
							storage_type: 'r2',
							source_family: 'file',
						},
					],
					rowCount: 1,
				};
			return { rows: [], rowCount: 1 };
		});
		const res = await erasureService.sweepPendingStorageDeletions();
		expect(res).toEqual({ deleted: 2, failed: 0, heldSkips: 0 });
		const drainSelects = db.query.mock.calls.filter(
			(c) => c[0].includes('FROM pending_storage_deletions') && c[0].includes('user_id = $1'),
		);
		expect(drainSelects.map((c) => c[1][0])).toEqual([7, 8]);
	});

	test('per-user failure isolation (review MEDIUM 3): one user\'s drain throw does not abort later users', async () => {
		db.query.mockImplementation(async (sql, params = []) => {
			if (sql.includes('SELECT DISTINCT user_id FROM pending_storage_deletions'))
				return { rows: [{ user_id: 7 }, { user_id: 8 }], rowCount: 2 };
			if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
			if (sql.includes('FROM pending_storage_deletions')) {
				if (params[0] === 7) throw new Error('db down for user 7');
				return {
					rows: [{ id: 8, file_url: '/api/files/u8.txt', storage_type: 'r2', source_family: 'file' }],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 1 };
		});
		const res = await erasureService.sweepPendingStorageDeletions();
		expect(res.deleted).toBe(1);
		expect(res.failed).toBe(0);
	});
});

describe('#1395 purgeDrainedStorageDeletions — self-transactional; the pool is its client factory', () => {
	function setupPurgeClient(sqlLog) {
		const client = { query: jest.fn(), release: jest.fn() };
		client.query.mockImplementation(async (sql, params = []) => {
			sqlLog.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
			if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
			if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ locked: true }], rowCount: 1 };
			if (/FOR UPDATE SKIP LOCKED/.test(sql))
				return {
					rows: [
						{
							id: 11,
							source_family: 'file',
							storage_type: 'r2',
							attempts: 1,
							created_at: new Date('2026-09-01T00:00:00Z'),
							updated_at: new Date('2026-10-01T00:00:00Z'),
						},
					],
					rowCount: 1,
				};
			if (/FROM legal_holds/.test(sql)) return { rows: [], rowCount: 0 };
			if (/FILTER \(WHERE status/.test(sql))
				return { rows: [{ eligible_deleted: 1, failed: 0, pending: 0 }], rowCount: 1 };
			if (/INSERT INTO audit_logs/.test(sql)) return { rows: [], rowCount: 1 };
			if (/DELETE FROM pending_storage_deletions/.test(sql)) return { rows: [], rowCount: 1 };
			throw new Error(`unexpected client query: ${sql.slice(0, 80)}`);
		});
		return client;
	}

	function routePool(sqlLog) {
		db.query.mockImplementation(async (sql) => {
			if (/GROUP BY user_id/.test(sql)) return { rows: [{ user_id: 7 }], rowCount: 1 };
			if (/FROM legal_holds/.test(sql)) return { rows: [], rowCount: 0 };
			if (/FILTER \(WHERE status/.test(sql))
				return { rows: [{ eligible_deleted: 1, failed: 0, pending: 0 }], rowCount: 1 };
			throw new Error(`unexpected pool query: ${sql.slice(0, 80)}`);
		});
		const client = setupPurgeClient(sqlLog);
		db.connect.mockImplementation(async () => client);
		return client;
	}

	test('no-arg call (the server.js shape): fold+delete run inside its OWN BEGIN...COMMIT on a dedicated client', async () => {
		const sqlLog = [];
		routePool(sqlLog);
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.ledgerRowsPurged).toBe(1);
		expect(res.usersPurged).toBe(1);
		expect(db.connect).toHaveBeenCalled();
		const begin = sqlLog.indexOf('BEGIN');
		const insert = sqlLog.findIndex((s) => s.startsWith('INSERT INTO'));
		const del = sqlLog.findIndex((s) => s.startsWith('DELETE FROM'));
		const commit = sqlLog.indexOf('COMMIT');
		expect(begin).toBeGreaterThanOrEqual(0);
		expect(insert).toBeGreaterThan(begin);
		expect(del).toBeGreaterThan(insert);
		expect(commit).toBeGreaterThan(del);
	});

	test('the pool singleton passed EXPLICITLY as queryable is accepted by design (contrast #1343: erasePersonalData rejects this same object)', async () => {
		const sqlLog = [];
		routePool(sqlLog);
		const res = await erasureService.purgeDrainedStorageDeletions({ queryable: db });
		expect(res.ledgerRowsPurged).toBe(1);
		expect(db.connect).toHaveBeenCalled();
		// The contrast is asserted, not narrated (review LOW 5e): the
		// SAME object is refused by erasePersonalData's #1343 guard.
		const err = await erasureService.erasePersonalData(7, { client: db }).catch((e) => e);
		expect(err.code).toBe('ERASURE_TRANSACTION_REQUIRED');
	});

	test('a connect-less queryable is REFUSED with a typed error before any data is touched (review HIGH 1)', async () => {
		// A bare {query} object is the latent #1343-class void for this
		// function: BEGIN on it is either non-sticky (pool-delegating) or
		// hijacks a caller transaction. The purge accepts only a pool.
		const bare = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
		const err = await erasureService
			.purgeDrainedStorageDeletions({ queryable: bare })
			.catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('ErasurePurgePoolRequiredError');
		expect(err.code).toBe('ERASURE_PURGE_POOL_REQUIRED');
		expect(bare.query).not.toHaveBeenCalled();
	});

	test('pool.connect() failure is contained per user (review LOW 6a): first user skipped as error, second still purges', async () => {
		const sqlLog = [];
		db.query.mockImplementation(async (sql) => {
			if (/GROUP BY user_id/.test(sql))
				return { rows: [{ user_id: 7 }, { user_id: 8 }], rowCount: 2 };
			if (/FROM legal_holds/.test(sql)) return { rows: [], rowCount: 0 };
			if (/FILTER \(WHERE status/.test(sql))
				return { rows: [{ eligible_deleted: 1, failed: 0, pending: 0 }], rowCount: 1 };
			throw new Error(`unexpected pool query: ${sql.slice(0, 80)}`);
		});
		const client = setupPurgeClient(sqlLog);
		db.connect
			.mockImplementationOnce(async () => {
				throw new Error('pool exhausted');
			})
			.mockImplementation(async () => client);
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.usersPurged).toBe(1);
		expect(res.usersSkipped).toBe(1);
		expect(res.perUser.find((u) => u.userId === 7)?.status).toBe('error');
		expect(res.perUser.find((u) => u.userId === 8)?.status).toBe('purged');
	});
});
