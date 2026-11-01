/**
 * #1128 GAP-I (K-2): storage-deletion ledger terminal purge +
 * Phase-2 audit metadata minimisation.
 *
 * D-1..D-6 purgeDrainedStorageDeletions: per-user tx, fold-then-delete,
 * three-way hold partition, disjoint counters.
 * D-8a drain aggregate audit: ONE biometric_audit_log entry per drain run
 * per subject, key-free metadata, error CLASS only, console line carries
 * ledger id + error class (never the key).
 * D-8b sanitizeErasureResult: storageKeys / nonPatternStorageUrls become
 * counts in a COPY; the in-process result is unchanged; no hashes.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(),
	deleteStorageObject: jest.fn(),
	getProviders: jest.fn(() => []),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const crypto = require('node:crypto');
const db = require('../../../lib/db');
const biometricAudit = require('../../../lib/biometricAudit');
const fileStorage = require('../../../lib/file-storage');
const erasureService = require('../../../lib/erasureService');
const { sanitizeErasureResult } = require('../../../lib/erasureResultSanitizer');

const digestOf = (ids) =>
	crypto.createHash('sha256').update([...ids].sort((a, b) => a - b).join(',')).digest('hex');

// ─── purge mock plumbing ────────────────────────────────────────────────────
// cfg: { candidates:[userId], heldPool:Set, throwPool:Set, heldClient:Set,
//        locked:{userId:[rows]}, agg:{userId:{eligible_deleted,failed,pending}},
//        insertError:Set(userId), deleteRowCount:{userId:n} }
function setupPurge(cfg) {
	const clients = [];
	db.query.mockImplementation(async (sql, params = []) => {
		if (/GROUP BY user_id/.test(sql) && /pending_storage_deletions/.test(sql)) {
			return { rows: cfg.candidates.map((user_id) => ({ user_id })), rowCount: cfg.candidates.length };
		}
		if (/FROM legal_holds/.test(sql)) {
			const uid = params[0];
			if (cfg.throwPool?.has(uid)) throw new Error('legal_holds lookup boom');
			if (cfg.heldPool?.has(uid)) return { rows: [{ id: 9, user_id: uid, company_id: null }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		}
		if (/FILTER \(WHERE status/.test(sql)) {
			if (cfg.countsFailPool?.has(params[0])) throw new Error('pool counts boom');
			const a = cfg.agg?.[params[0]] || { eligible_deleted: 0, failed: 0, pending: 0 };
			return { rows: [a], rowCount: 1 };
		}
		throw new Error(`unexpected pool query: ${sql.slice(0, 80)}`);
	});
	db.connect.mockImplementation(async () => {
		const client = { query: jest.fn(), release: jest.fn(), _uid: null };
		client.query.mockImplementation(async (sql, params = []) => {
			if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
			if (/pg_try_advisory_xact_lock/.test(sql))
				return { rows: [{ locked: cfg.advisoryLocked !== false }], rowCount: 1 };
			if (/FOR UPDATE SKIP LOCKED/.test(sql)) {
				client._uid = params[0];
				const rows = cfg.locked?.[params[0]] || [];
				return { rows, rowCount: rows.length };
			}
			// #1178: the DELETE branch MUST be matched before the
			// legal_holds branch — the purge DELETE itself now contains
			// a legal_holds subquery (the statement-time hold predicate),
			// so a legal_holds-first match would swallow the DELETE.
			if (/DELETE FROM pending_storage_deletions/.test(sql)) {
				const n = cfg.deleteRowCount?.[client._uid];
				if (n != null) return { rows: [], rowCount: n };
				// #1178 phantom simulation: a hold COMMITTED after the in-tx
				// re-check but before this DELETE. Statement-time semantics:
				// a DELETE whose WHERE carries the legal_holds predicate sees
				// the hold and deletes 0 rows; a DELETE without it purges.
				if (cfg.phantomHold?.has(client._uid)) {
					const blocked = /FROM legal_holds/.test(sql);
					return { rows: [], rowCount: blocked ? 0 : (cfg.locked?.[client._uid] || []).length };
				}
				return { rows: [], rowCount: (cfg.locked?.[client._uid] || []).length };
			}
			if (/FROM legal_holds/.test(sql)) {
				const uid = params[0];
				if (cfg.heldClient?.has(uid)) return { rows: [{ id: 10, user_id: uid, company_id: null }], rowCount: 1 };
				return { rows: [], rowCount: 0 };
			}
			if (/FILTER \(WHERE status/.test(sql)) {
				if (cfg.countsFailClient?.has(params[0])) throw new Error('client counts boom');
				const a = cfg.agg?.[params[0]] || { eligible_deleted: 0, failed: 0, pending: 0 };
				return { rows: [a], rowCount: 1 };
			}
			if (/INSERT INTO audit_logs/.test(sql)) {
				if (cfg.insertError?.has(client._uid)) throw new Error('fold insert boom');
				return { rows: [{ id: 1 }], rowCount: 1 };
			}
			throw new Error(`unexpected client query: ${sql.slice(0, 80)}`);
		});
		clients.push(client);
		return client;
	});
	return clients;
}

const ROW = (id, over = {}) => ({
	id,
	source_family: 'file',
	storage_type: 'r2',
	attempts: 1,
	created_at: new Date('2026-09-01T00:00:00Z'),
	updated_at: new Date('2026-10-01T00:00:00Z'),
	...over,
});

describe('#1128 purgeDrainedStorageDeletions (D-1..D-6)', () => {
	beforeEach(() => jest.resetAllMocks());

	test('exports exist', () => {
		expect(typeof erasureService.purgeDrainedStorageDeletions).toBe('function');
		expect(typeof erasureService.sanitizeErasureResult).toBe('function');
		expect(erasureService.STORAGE_DELETION_PURGE_GRACE_DAYS).toBe(7);
	});

	test('clear user: fold INSERT (bounded, key-free) BEFORE DELETE in one tx; counters + digest', async () => {
		const locked = [
			ROW(11, { attempts: 2 }),
			ROW(12, { source_family: 'observer_audio', storage_type: 'local', attempts: 3, created_at: new Date('2026-09-02T00:00:00Z'), updated_at: new Date('2026-10-02T00:00:00Z') }),
		];
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: locked },
			agg: { 7: { eligible_deleted: 2, failed: 1, pending: 2 } },
		});

		const res = await erasureService.purgeDrainedStorageDeletions();

		expect(res.ledgerRowsPurged).toBe(2);
		expect(res.ledgerRowsRetainedFailed).toBe(1);
		expect(res.ledgerRowsRetainedPending).toBe(2);
		expect(res.ledgerRowsRetainedHeld).toBe(0);
		expect(res.ledgerHoldLookupFailed).toBe(0);
		expect(res.usersPurged).toBe(1);
		expect(res.usersSkipped).toBe(0);
		expect(res.perUser).toEqual([
			expect.objectContaining({ userId: 7, status: 'purged', ledgerRowsPurged: 2, retainedFailed: 1, retainedPending: 2 }),
		]);

		expect(clients).toHaveLength(1);
		const calls = clients[0].query.mock.calls;
		const sqls = calls.map(([s]) => s);
		expect(sqls[0]).toBe('BEGIN');
		expect(sqls[sqls.length - 1]).toBe('COMMIT');
		const insertIdx = sqls.findIndex((s) => /INSERT INTO audit_logs/.test(s));
		const deleteIdx = sqls.findIndex((s) => /DELETE FROM pending_storage_deletions/.test(s));
		expect(insertIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeGreaterThan(insertIdx);

		const [, params] = calls[insertIdx];
		expect(params[0]).toBe('storage_deletion_ledger_purged');
		expect(params[1]).toBeNull(); // user_id = actor: never fabricated
		expect(params[2]).toBe('user');
		expect(params[3]).toBe(7);
		const meta = JSON.parse(params[4]);
		expect(meta).toEqual({
			gap_i_fold_version: 1,
			ledger_rows_purged: 2,
			objects_deleted: 2,
			by_source_family: { file: 1, observer_audio: 1 },
			by_storage_type: { r2: 1, local: 1 },
			attempts_total: 5,
			ledger_created_min: '2026-09-01T00:00:00.000Z',
			ledger_created_max: '2026-09-02T00:00:00.000Z',
			terminal_min: '2026-10-01T00:00:00.000Z',
			terminal_max: '2026-10-02T00:00:00.000Z',
			grace_days: 7,
			batch_digest: digestOf([11, 12]),
			retained_failed: 1,
			retained_pending: 2,
			retained_held: 0,
			hold_lookup_failed: 0,
		});
		expect(JSON.stringify(meta)).not.toMatch(/file_url|storage_key|\/api\/files\//);

		// DELETE re-states the eligibility predicate, by locked ids.
		const delCall = calls[deleteIdx];
		expect(delCall[0]).toMatch(/status = 'deleted'/);
		expect(delCall[0]).toMatch(/INTERVAL '7 days'/);
		expect(delCall[1][0]).toEqual([11, 12]);
		expect(clients[0].release).toHaveBeenCalled();
	});

	test('eligibility predicate: status deleted + updated_at grace, never created_at', async () => {
		setupPurge({ candidates: [], locked: {}, agg: {} });
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res).toMatchObject({ ledgerRowsPurged: 0, usersPurged: 0, usersSkipped: 0 });
		const candSql = db.query.mock.calls.find(([s]) => /pending_storage_deletions/.test(s))[0];
		expect(candSql).toMatch(/status = 'deleted'/);
		expect(candSql).toMatch(/updated_at < NOW\(\) - INTERVAL '7 days'/);
		expect(candSql).not.toMatch(/created_at </);
		expect(db.connect).not.toHaveBeenCalled();
	});

	test('held user (pre-pass): no tx, eligible rows counted retainedHeld, failed/pending disjoint', async () => {
		setupPurge({
			candidates: [7],
			heldPool: new Set([7]),
			locked: {},
			agg: { 7: { eligible_deleted: 3, failed: 1, pending: 1 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(db.connect).not.toHaveBeenCalled();
		expect(res.ledgerRowsPurged).toBe(0);
		expect(res.ledgerRowsRetainedHeld).toBe(3);
		expect(res.ledgerRowsRetainedFailed).toBe(1);
		expect(res.ledgerRowsRetainedPending).toBe(1);
		expect(res.usersPurged).toBe(0);
		expect(res.usersSkipped).toBe(1);
		expect(res.perUser[0]).toMatchObject({ userId: 7, status: 'held', retainedHeld: 3 });
	});

	test('lookup-failed user (pre-pass throws): preserved, counted separately, run does not abort', async () => {
		setupPurge({
			candidates: [7, 8],
			throwPool: new Set([7]),
			locked: { 8: [ROW(21)] },
			agg: { 7: { eligible_deleted: 2, failed: 0, pending: 0 }, 8: { eligible_deleted: 1, failed: 0, pending: 0 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.ledgerHoldLookupFailed).toBe(2);
		expect(res.ledgerRowsRetainedHeld).toBe(0);
		expect(res.ledgerRowsPurged).toBe(1); // user 8 still purged
		expect(res.usersPurged).toBe(1);
		expect(res.usersSkipped).toBe(1);
		expect(res.perUser.find((u) => u.userId === 7).status).toBe('lookup_failed');
	});

	test('in-tx hold re-check: ROLLBACK that user only, no fold, no delete', async () => {
		const clients = setupPurge({
			candidates: [7],
			heldClient: new Set([7]),
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 0, pending: 0 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls).toContain('ROLLBACK');
		expect(sqls.some((s) => /INSERT INTO audit_logs/.test(s))).toBe(false);
		expect(sqls.some((s) => /DELETE FROM pending_storage_deletions/.test(s))).toBe(false);
		expect(res.ledgerRowsPurged).toBe(0);
		expect(res.ledgerRowsRetainedHeld).toBe(2);
		expect(res.usersSkipped).toBe(1);
	});

	test('fold INSERT failure: ROLLBACK, DELETE never runs, another user still purges', async () => {
		const clients = setupPurge({
			candidates: [7, 8],
			locked: { 7: [ROW(11)], 8: [ROW(21)] },
			agg: { 7: { eligible_deleted: 1, failed: 0, pending: 0 }, 8: { eligible_deleted: 1, failed: 0, pending: 0 } },
			insertError: new Set([7]),
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls7 = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls7).toContain('ROLLBACK');
		expect(sqls7.some((s) => /DELETE FROM pending_storage_deletions/.test(s))).toBe(false);
		expect(res.ledgerRowsPurged).toBe(1);
		expect(res.usersPurged).toBe(1);
		expect(res.usersSkipped).toBe(1);
		expect(res.perUser.find((u) => u.userId === 7).status).toBe('error');
	});

	test('DELETE rowCount mismatch vs locked count: ROLLBACK, nothing counted purged', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 0, pending: 0 } },
			deleteRowCount: { 7: 1 },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls).toContain('ROLLBACK');
		expect(sqls).not.toContain('COMMIT');
		expect(res.ledgerRowsPurged).toBe(0);
		expect(res.usersPurged).toBe(0);
	});

	test('advisory lock lost to a parallel run: skipped, no fold, no delete', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11)] },
			agg: { 7: { eligible_deleted: 1, failed: 0, pending: 0 } },
			advisoryLocked: false,
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls.some((s) => /INSERT INTO audit_logs/.test(s))).toBe(false);
		expect(sqls.some((s) => /DELETE FROM pending_storage_deletions/.test(s))).toBe(false);
		expect(res.usersPurged).toBe(0);
		expect(res.usersSkipped).toBe(1);
	});

	test('no locked rows in tx (concurrent run won): skipped, no fold row', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [] },
			agg: { 7: { eligible_deleted: 0, failed: 0, pending: 0 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls.some((s) => /INSERT INTO audit_logs/.test(s))).toBe(false);
		expect(res.usersPurged).toBe(0);
		expect(res.usersSkipped).toBe(1);
	});
});


describe('#1176 purge reporting completeness (skip-path counts + containment)', () => {
	beforeEach(() => jest.resetAllMocks());

	test('in-tx held path contributes retained failed/pending exactly once', async () => {
		setupPurge({
			candidates: [7],
			heldClient: new Set([7]),
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 3, pending: 4 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.perUser[0]).toMatchObject({ status: 'held', retainedHeld: 2, retainedFailed: 3, retainedPending: 4 });
		expect(res.ledgerRowsRetainedFailed).toBe(3);
		expect(res.ledgerRowsRetainedPending).toBe(4);
		expect(res.ledgerRowsRetainedHeld).toBe(2);
		expect(res.ledgerRowsPurged).toBe(0);
	});

	test('advisory-lock-lost skip contributes retained failed/pending exactly once', async () => {
		setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11)] },
			agg: { 7: { eligible_deleted: 1, failed: 2, pending: 1 } },
			advisoryLocked: false,
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.usersSkipped).toBe(1);
		expect(res.ledgerRowsRetainedFailed).toBe(2);
		expect(res.ledgerRowsRetainedPending).toBe(1);
		expect(res.perUser[0]).toMatchObject({ retainedFailed: 2, retainedPending: 1 });
	});

	test('zero-locked-rows skip contributes retained failed/pending exactly once', async () => {
		setupPurge({
			candidates: [7],
			locked: { 7: [] },
			agg: { 7: { eligible_deleted: 0, failed: 5, pending: 6 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.usersSkipped).toBe(1);
		expect(res.ledgerRowsRetainedFailed).toBe(5);
		expect(res.ledgerRowsRetainedPending).toBe(6);
		expect(res.perUser[0]).toMatchObject({ retainedFailed: 5, retainedPending: 6 });
	});

	test('pre-pass countsFor failure is contained per-user: user errors, run continues, no counts fabricated', async () => {
		setupPurge({
			candidates: [7, 8],
			throwPool: new Set([7]),
			countsFailPool: new Set([7]),
			locked: { 8: [ROW(21)] },
			agg: { 7: { eligible_deleted: 2, failed: 9, pending: 9 }, 8: { eligible_deleted: 1, failed: 0, pending: 0 } },
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const res = await erasureService.purgeDrainedStorageDeletions();
		errSpy.mockRestore();
		expect(res.perUser.find((u) => u.userId === 7).status).toBe('error');
		expect(res.perUser.find((u) => u.userId === 8).status).toBe('purged');
		expect(res.ledgerRowsPurged).toBe(1);
		expect(res.ledgerRowsRetainedFailed).toBe(0);
		expect(res.ledgerHoldLookupFailed).toBe(0);
		expect(res.usersSkipped).toBe(1);
	});

	test('counts failure on the in-tx held skip path fails closed: error, nothing counted', async () => {
		setupPurge({
			candidates: [7],
			heldClient: new Set([7]),
			countsFailClient: new Set([7]),
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 3, pending: 4 } },
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const res = await erasureService.purgeDrainedStorageDeletions();
		errSpy.mockRestore();
		expect(res.perUser[0].status).toBe('error');
		expect(res.ledgerRowsRetainedFailed).toBe(0);
		expect(res.ledgerRowsRetainedPending).toBe(0);
		expect(res.ledgerRowsPurged).toBe(0);
		expect(res.usersSkipped).toBe(1);
	});
});

describe('#1176 purge log prefix (server.js)', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'server.js'), 'utf8');

	test('purge counters are NOT under the retention DRY-RUN/LIVE mode label; purge has its own log line', () => {
		const modeLine = src.split('\n').find((l) => l.includes('${mode}:'));
		expect(modeLine).toBeDefined();
		expect(modeLine).not.toContain('storage_ledger_purged');
		const purgeIdx = src.indexOf('storage_ledger_purged=');
		expect(purgeIdx).toBeGreaterThan(-1);
		const purgeStmt = src.slice(src.lastIndexOf('console.log(', purgeIdx), purgeIdx);
		expect(purgeStmt).toContain('[erasure]');
		expect(purgeStmt).not.toContain('${mode}');
	});
});

describe('#1178 hold predicate inside the purge DELETE (TOCTOU phantom)', () => {
	beforeEach(() => jest.resetAllMocks());

	test('phantom hold (committed between in-tx re-check and DELETE): statement-time predicate blocks the purge — ROLLBACK, fold does not survive, nothing purged', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 1, pending: 2 } },
			phantomHold: new Set([7]),
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const res = await erasureService.purgeDrainedStorageDeletions();
		errSpy.mockRestore();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		// The fold INSERT ran in-tx, then the DELETE, then ROLLBACK — the
		// fold can never commit without the full DELETE succeeding.
		const insertIdx = sqls.findIndex((s) => /INSERT INTO audit_logs/.test(s));
		const deleteIdx = sqls.findIndex((s) => /DELETE FROM pending_storage_deletions/.test(s));
		expect(insertIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeGreaterThan(insertIdx);
		expect(sqls).toContain('ROLLBACK');
		expect(sqls).not.toContain('COMMIT');
		expect(res.ledgerRowsPurged).toBe(0);
		expect(res.usersPurged).toBe(0);
		expect(res.usersSkipped).toBe(1);
		expect(res.perUser[0].status).toBe('error');
	});

	test('DELETE SQL carries the exact session-less notHeldPredicate shape on pending_storage_deletions.user_id', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11)] },
			agg: { 7: { eligible_deleted: 1, failed: 0, pending: 0 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		expect(res.ledgerRowsPurged).toBe(1);
		const delCall = clients[0].query.mock.calls.find(([s]) => /DELETE FROM pending_storage_deletions/.test(s));
		expect(delCall).toBeDefined();
		const sql = delCall[0];
		expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM legal_holds lh/);
		expect(sql).toMatch(/lh\.released_at IS NULL/);
		expect(sql).toMatch(/lh\.user_id = pending_storage_deletions\.user_id/);
		expect(sql).toMatch(/lh\.company_id = \(SELECT u_lh\.company_id FROM users u_lh WHERE u_lh\.id = pending_storage_deletions\.user_id\)/);
		expect(sql).toMatch(/lh\.company_id IN \(SELECT s_lh\.company_id FROM interview_sessions s_lh WHERE s_lh\.candidate_id = pending_storage_deletions\.user_id\)/);
		// Eligibility predicate is still re-stated alongside the hold predicate.
		expect(sql).toMatch(/status = 'deleted'/);
		expect(delCall[1][0]).toEqual([11]);
	});

	test('counters exactly-once on the phantom throw path: retained failed/pending counted once, purged 0, blocked rows not misreported as held this run', async () => {
		setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 3, pending: 4 } },
			phantomHold: new Set([7]),
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const res = await erasureService.purgeDrainedStorageDeletions();
		errSpy.mockRestore();
		expect(res.ledgerRowsRetainedFailed).toBe(3);
		expect(res.ledgerRowsRetainedPending).toBe(4);
		expect(res.perUser[0]).toMatchObject({ retainedFailed: 3, retainedPending: 4 });
		expect(res.ledgerRowsPurged).toBe(0);
		// Wrinkle pinned (see STOP 1 on #1178): the blocked eligible rows are
		// retained via ROLLBACK but classify as 'error' this run, not 'held';
		// the next run's pre-pass reports them as held.
		expect(res.ledgerRowsRetainedHeld).toBe(0);
		expect(res.perUser[0].status).toBe('error');
	});

	test('no hold anywhere: purge unchanged (fold + DELETE + COMMIT, counters as before)', async () => {
		const clients = setupPurge({
			candidates: [7],
			locked: { 7: [ROW(11), ROW(12)] },
			agg: { 7: { eligible_deleted: 2, failed: 1, pending: 2 } },
		});
		const res = await erasureService.purgeDrainedStorageDeletions();
		const sqls = clients[0].query.mock.calls.map(([s]) => s);
		expect(sqls[sqls.length - 1]).toBe('COMMIT');
		expect(res).toMatchObject({
			ledgerRowsPurged: 2,
			ledgerRowsRetainedFailed: 1,
			ledgerRowsRetainedPending: 2,
			ledgerRowsRetainedHeld: 0,
			usersPurged: 1,
			usersSkipped: 0,
		});
		expect(res.perUser[0]).toMatchObject({ status: 'purged', ledgerRowsPurged: 2 });
	});
});

describe('#1128 sanitizeErasureResult (D-8b)', () => {
	const KEY1 = '/api/files/r2/cv/secret-1.pdf';
	const KEY2 = 'https://storage.example.com/bucket/secret-2.pdf';
	const sample = () => ({
		shredded: true,
		storageKeys: [KEY1, KEY2],
		storageFilesDeleted: 4,
		gapC: { scheduledInterviews: 2, nonPatternStorageUrls: [KEY2], storageLedgered: 1 },
		gapD: { offersRedacted: 1, nonPatternStorageUrls: [KEY1, KEY2] },
		gapB: { scoreSnapshots: 3 },
		applicationKeyedHeldDetails: [{ table: 'ai_screenings', id: 5, reason: 'held_company' }],
	});

	test('counts replace raw-key arrays; in-process object untouched; no hash anywhere', () => {
		const input = sample();
		const out = sanitizeErasureResult(input);
		expect(out.storageKeys).toBeUndefined();
		expect(out.storageKeysCount).toBe(2);
		expect(out.gapC.nonPatternStorageUrls).toBeUndefined();
		expect(out.gapC.nonPatternStorageUrlCount).toBe(1);
		expect(out.gapD.nonPatternStorageUrls).toBeUndefined();
		expect(out.gapD.nonPatternStorageUrlCount).toBe(2);
		expect(out.shredded).toBe(true);
		expect(out.gapC.scheduledInterviews).toBe(2);
		expect(out.gapB).toEqual({ scoreSnapshots: 3 });
		expect(out.applicationKeyedHeldDetails).toEqual(input.applicationKeyedHeldDetails);
		const s = JSON.stringify(out);
		expect(s).not.toContain(KEY1);
		expect(s).not.toContain(KEY2);
		expect(s).not.toMatch(/sha256|digest|hash/i);
		// original unchanged
		expect(input.storageKeys).toEqual([KEY1, KEY2]);
		expect(input.gapC.nonPatternStorageUrls).toEqual([KEY2]);
	});

	test('also reachable via erasureService export (same function)', () => {
		expect(erasureService.sanitizeErasureResult).toBe(sanitizeErasureResult);
	});

	test('drops stray file_url / object_key carriers at any depth', () => {
		const out = sanitizeErasureResult({ nested: { file_url: KEY1, object_key: KEY2, keep: 1 } });
		expect(JSON.stringify(out)).not.toContain(KEY1);
		expect(JSON.stringify(out)).not.toContain(KEY2);
		expect(out.nested.keep).toBe(1);
	});

	test('null / non-object passthrough', () => {
		expect(sanitizeErasureResult(null)).toBeNull();
		expect(sanitizeErasureResult(undefined)).toBeUndefined();
		expect(sanitizeErasureResult(42)).toBe(42);
	});
});

describe('#1128 drain aggregate audit (D-8a)', () => {
	beforeEach(() => jest.resetAllMocks());

	test('one aggregate logAccess per run; key-free metadata; console line = ledger id + error class only', async () => {
		const entries = [
			{ id: 31, file_url: '/api/files/r2/cv/ok.pdf', storage_type: 'r2', source_family: 'file' },
			{ id: 32, file_url: '/api/files/r2/cv/bad.pdf', storage_type: 'r2', source_family: 'observer_audio' },
		];
		db.query.mockImplementation(async (sql) => {
			if (/FROM legal_holds/.test(sql)) return { rows: [], rowCount: 0 };
			if (/FROM pending_storage_deletions/.test(sql)) return { rows: entries, rowCount: entries.length };
			return { rows: [], rowCount: 1 };
		});
		fileStorage.deleteFile
			.mockResolvedValueOnce({ deleted: true })
			.mockResolvedValueOnce({ deleted: false, reason: 'provider_down' });
		biometricAudit.logAccess.mockResolvedValue({ id: 1 });
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const res = await erasureService.deleteErasedStorageFiles(7, { audit: { userId: 7, userRole: 'candidate' } });

		expect(res.deleted).toBe(1);
		expect(res.failed).toBe(1);
		expect(res.heldSkips).toBe(0);
		expect(biometricAudit.logAccess).toHaveBeenCalledTimes(1);
		const arg = biometricAudit.logAccess.mock.calls[0][0];
		expect(arg.action).toBe('delete');
		expect(arg.dataType).toBe('storage_file');
		expect(arg.metadata).toEqual({
			deleted: 1,
			failed: 1,
			heldSkips: 0,
			ownershipSkips: 0,
			ownershipLookupFailed: 0,
			ownershipSkipsByFamily: {},
			bySourceFamily: { file: 1, observer_audio: 1 },
			byStorageType: { r2: 2 },
			errorClassCounts: { Error: 1 },
		});
		expect(JSON.stringify(arg)).not.toContain('/api/files/');
		const logged = errSpy.mock.calls.flat().join(' ');
		expect(logged).toContain('32');
		expect(logged).not.toContain('bad.pdf');
		expect(logged).not.toContain('/api/files/');
		errSpy.mockRestore();
	});

	test('no pending entries: no audit entry, exact legacy no-op result', async () => {
		db.query.mockResolvedValueOnce({ rows: [] });
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res).toEqual({
			deleted: 0,
			failed: 0,
			failures: [],
			heldSkips: 0,
			ownershipSkips: 0,
			ownershipLookupFailed: 0,
			ownershipSkipsByFamily: {},
		});
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});
});
