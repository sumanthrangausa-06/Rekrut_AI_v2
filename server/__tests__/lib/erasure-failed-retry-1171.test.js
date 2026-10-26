/**
 * #1171: dead-letter lifecycle for pending_storage_deletions.
 *
 * Before this story: deleteErasedStorageFiles and
 * sweepPendingStorageDeletions selected only status='pending', so a
 * 'failed' row was a permanent dead letter — the object could still
 * exist and the row's file_url was the only pointer to it.
 *
 * Design (STOP 1 on #1171, Nova): bounded retry inside the shared
 * drain — a 'failed' row is eligible again while attempts <
 * STORAGE_DELETION_MAX_ATTEMPTS (attempts column already exists,
 * migration 252; NO schema change). At/over the bound it stays
 * 'failed' for manual disposition:
 * disposeFailedStorageDeletionsVerifiedAbsent — an ops-attested,
 * per-user/per-row fold+delete whose audit metadata counts the rows
 * as failed_verified_absent and NEVER as objects_deleted.
 *
 * The mocked DB below emulates the selection predicate from the SQL
 * text (same style as observer-audio-erasure.test.js): on pristine
 * dev the drain/sweep SELECTs mention no 'failed' eligibility, so a
 * 'failed' row is never returned and the retry tests are RED.
 * Mocked evidence only here; the real-DB E2E proof is Quinn's
 * AFTER-capture gate on dev, seated by Lead after this PR.
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

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const { deleteFile } = require('../../../lib/file-storage');
const erasureService = require('../../../lib/erasureService');

let S;
function entry(over = {}) {
	return {
		id: 1,
		user_id: 7,
		file_url: '/api/files/a%2Fb.txt',
		storage_type: 'r2',
		source_family: 'file',
		status: 'failed',
		attempts: 1,
		created_at: new Date('2026-10-01T00:00:00Z'),
		updated_at: new Date('2026-10-02T00:00:00Z'),
		...over,
	};
}

function eligibleForDrain(e, sql, max) {
	if (e.status === 'pending') return true;
	// A failed row is drainable only when the SELECT itself carries
	// failed-eligibility (pristine SQL does not) and it is under bound.
	return sql.includes("'failed'") && e.status === 'failed' && e.attempts < max;
}

async function route(sql, params = []) {
	const text = String(sql);
	if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
		S.order.push(text);
		return { rows: [], rowCount: 0 };
	}
	if (/pg_try_advisory_xact_lock/.test(text)) return { rows: [{ locked: true }], rowCount: 1 };
	if (/DELETE FROM pending_storage_deletions/.test(text)) {
		const ids = params[0] || [];
		const matched = S.entries.filter((e) => ids.includes(e.id) && e.status === 'failed');
		S.entries = S.entries.filter((e) => !matched.includes(e));
		S.order.push('ledger-delete');
		return { rows: [], rowCount: S.deleteRowCountOverride ?? matched.length };
	}
	if (/INSERT INTO audit_logs/.test(text)) {
		S.folds.push({ params, metadata: JSON.parse(params[4]) });
		S.order.push('fold-insert');
		return { rows: [], rowCount: 1 };
	}
	if (/FROM legal_holds/.test(text)) {
		if (S.holdError) throw new Error('hold lookup down');
		return { rows: S.held ? [{ id: 1, user_id: 7, company_id: null }] : [], rowCount: S.held ? 1 : 0 };
	}
	if (/FROM pending_storage_deletions/.test(text) && /FOR UPDATE SKIP LOCKED/.test(text)) {
		const ids = params[1] || [];
		return {
			rows: S.entries.filter((e) => e.user_id === params[0] && e.status === 'failed' && ids.includes(e.id)),
			rowCount: 1,
		};
	}
	if (text.includes('SELECT DISTINCT user_id FROM pending_storage_deletions')) {
		const max = params[0];
		const users = [...new Set(S.entries.filter((e) => eligibleForDrain(e, text, max)).map((e) => e.user_id))].sort(
			(a, b) => a - b,
		);
		return { rows: users.map((user_id) => ({ user_id })), rowCount: users.length };
	}
	if (/FROM pending_storage_deletions/.test(text)) {
		const max = params[1];
		const rows = S.entries.filter((e) => e.user_id === params[0] && eligibleForDrain(e, text, max));
		return { rows, rowCount: rows.length };
	}
	if (/UPDATE pending_storage_deletions/.test(text)) {
		const e = S.entries.find((x) => x.id === params[2]);
		if (e) {
			e.status = params[0];
			e.attempts += 1;
		}
		return { rows: [], rowCount: e ? 1 : 0 };
	}
	return { rows: [], rowCount: 1 };
}

beforeEach(() => {
	jest.clearAllMocks();
	S = { entries: [], held: false, holdError: false, folds: [], order: [], deleteRowCountOverride: null };
	deleteFile.mockImplementation(async () => ({ deleted: true }));
	db.query.mockImplementation(route);
	const client = { query: jest.fn(route), release: jest.fn() };
	db.connect.mockImplementation(async () => client);
	S.client = client;
});

describe('#1171 bounded retry of failed ledger rows', () => {
	test('export surface: bound constant + disposition function present', () => {
		expect(erasureService.STORAGE_DELETION_MAX_ATTEMPTS).toBe(5);
		expect(typeof erasureService.disposeFailedStorageDeletionsVerifiedAbsent).toBe('function');
	});

	test('a failed row under the attempt bound is retried by the drain and becomes deleted', async () => {
		S.entries = [entry()];
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(1);
		expect(res.failed).toBe(0);
		expect(S.entries[0].status).toBe('deleted');
		expect(deleteFile).toHaveBeenCalledTimes(1);
	});

	test('a failed row that fails again stays failed with attempts incremented (not lost, not deleted)', async () => {
		S.entries = [entry()];
		deleteFile.mockImplementation(async () => ({ deleted: false, alreadyGone: false, reason: 'denied' }));
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(0);
		expect(res.failed).toBe(1);
		expect(S.entries[0].status).toBe('failed');
		expect(S.entries[0].attempts).toBe(2);
	});

	test('a failed row AT the attempt bound is never retried again (dead letter preserved for disposition)', async () => {
		S.entries = [entry({ attempts: erasureService.STORAGE_DELETION_MAX_ATTEMPTS || 5 })];
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res).toEqual({ deleted: 0, failed: 0, failures: [], heldSkips: 0 });
		expect(deleteFile).not.toHaveBeenCalled();
		expect(S.entries[0].status).toBe('failed');
	});

	test('held failed row: per-row hold consult skips it, status stays failed, object NOT deleted', async () => {
		S.entries = [entry()];
		S.held = true;
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(0);
		expect(res.heldSkips).toBe(1);
		expect(deleteFile).not.toHaveBeenCalled();
		expect(S.entries[0].status).toBe('failed');
	});

	test('sweep enumerates a user whose ONLY rows are failed-under-bound and drains them', async () => {
		S.entries = [entry()];
		const res = await erasureService.sweepPendingStorageDeletions();
		expect(res.deleted).toBe(1);
		expect(S.entries[0].status).toBe('deleted');
	});

	test('pending rows still drain exactly as before (no regression)', async () => {
		S.entries = [entry({ status: 'pending', attempts: 0 })];
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(1);
		expect(S.entries[0].status).toBe('deleted');
	});
});

describe('#1171 manual disposition — ops-verified-absent fold', () => {
	const call = (over = {}) =>
		erasureService.disposeFailedStorageDeletionsVerifiedAbsent({
			userId: 7,
			ledgerIds: [1],
			verifiedAbsent: true,
			...over,
		});

	test('refuses without the explicit verifiedAbsent attestation, before touching data', async () => {
		S.entries = [entry()];
		const err = await call({ verifiedAbsent: undefined }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('ERASURE_VERIFIED_ABSENT_ATTESTATION_REQUIRED');
		expect(S.entries).toHaveLength(1);
		expect(S.folds).toHaveLength(0);
	});

	test('happy path: fold counts failed_verified_absent (objects_deleted 0, no file_url persisted), then rows deleted in-tx', async () => {
		S.entries = [entry(), entry({ id: 2, file_url: '/api/files/c%2Fd.txt' })];
		const res = await call({ ledgerIds: [1, 2] });
		expect(res.status).toBe('disposed');
		expect(res.failedVerifiedAbsent).toBe(2);
		expect(S.entries).toHaveLength(0);
		expect(S.folds).toHaveLength(1);
		const md = S.folds[0].metadata;
		expect(md.failed_verified_absent).toBe(2);
		expect(md.objects_deleted ?? 0).toBe(0);
		expect(JSON.stringify(md)).not.toContain('file_url');
		expect(JSON.stringify(md)).not.toContain('/api/files/');
		expect(S.order.indexOf('fold-insert')).toBeGreaterThan(S.order.indexOf('BEGIN'));
		expect(S.order.indexOf('ledger-delete')).toBeGreaterThan(S.order.indexOf('fold-insert'));
		expect(S.order.indexOf('COMMIT')).toBeGreaterThan(S.order.indexOf('ledger-delete'));
		// Disposition must never attempt a storage delete itself.
		expect(deleteFile).not.toHaveBeenCalled();
	});

	test('held user: disposition disposes NOTHING (fail-closed hold)', async () => {
		S.entries = [entry()];
		S.held = true;
		const res = await call();
		expect(res.status).toBe('held');
		expect(res.failedVerifiedAbsent).toBe(0);
		expect(S.entries).toHaveLength(1);
		expect(S.folds).toHaveLength(0);
	});

	test('hold lookup failure: disposition disposes NOTHING and reports lookup_failed', async () => {
		S.entries = [entry()];
		S.holdError = true;
		const res = await call();
		expect(res.status).toBe('lookup_failed');
		expect(S.entries).toHaveLength(1);
		expect(S.folds).toHaveLength(0);
	});

	test('only named, still-failed rows are disposed — a pending row with a named id blocks the batch (count mismatch rolls back)', async () => {
		S.entries = [entry({ status: 'pending' })];
		const res = await call();
		expect(res.status).toBe('error');
		expect(S.entries).toHaveLength(1);
		expect(S.entries[0].status).toBe('pending');
	});
});
