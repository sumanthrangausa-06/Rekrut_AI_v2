/**
 * #1396 (follow-up of #1343 M2): erasePersonalData accepts a BEGIN-less
 * client — the #1343 guard checks presence/interface only, so a real pg
 * Client that never issued BEGIN still autocommits statement-by-statement
 * and a mid-erasure fail-closed throw cannot roll back earlier writes.
 *
 * Contract pinned here (mocked evidence only; the real-DB proof is the
 * E2E-on-dev gate recorded in the PR):
 *  - A client whose transaction-state probe reports "no transaction in
 *    progress" (Postgres SAVEPOINT outside a tx block → SQLSTATE 25P01)
 *    is refused with the #1343 typed error BEFORE any data statement.
 *  - A client genuinely inside BEGIN…COMMIT (probe succeeds) is NOT
 *    blocked by the guard.
 *  - A probe failure that is not 25P01 (e.g. 25P02, aborted transaction)
 *    propagates fail-closed — the erasure never proceeds.
 *  - The #1343 refusals (no client / pool singleton) are untouched.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
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

const pool = require('../../../lib/db');
const erasureService = require('../../../lib/erasureService');

const PROBE_SQL = /SAVEPOINT erasure_tx_guard_probe/i;

function pgError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

// A client shaped like a real pg Client that is NOT inside a transaction:
// the SAVEPOINT probe fails 25P01 exactly as Postgres behaves outside a
// transaction block; every other statement would autocommit-succeed.
function makeBeginlessClient() {
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql) => {
		if (PROBE_SQL.test(String(sql))) {
			throw pgError('25P01', 'SAVEPOINT can only be used in transaction blocks');
		}
		return { rows: [], rowCount: 1 };
	});
	return client;
}

// A client genuinely inside BEGIN…COMMIT: the probe succeeds, all other
// statements succeed (the #1343 control-client shape).
function makeInTransactionClient() {
	const client = { query: jest.fn() };
	client.query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
	return client;
}

// A client inside a transaction that is already aborted: the probe fails
// 25P02 — fail-closed means this error propagates, never a silent proceed.
function makeAbortedTransactionClient() {
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql) => {
		if (PROBE_SQL.test(String(sql))) {
			throw pgError(
				'25P02',
				'current transaction is aborted, commands ignored until end of transaction block',
			);
		}
		return { rows: [], rowCount: 1 };
	});
	return client;
}

describe('#1396 erasePersonalData — BEGIN-less client is refused', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
	});

	test('rejects a BEGIN-less client with the #1343 typed error, before any data statement', async () => {
		const client = makeBeginlessClient();
		const err = await erasureService
			.erasePersonalData(7, { client })
			.catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('ErasureTransactionRequiredError');
		expect(err.code).toBe('ERASURE_TRANSACTION_REQUIRED');
		// Fail-closed BEFORE any data access: the only statement the
		// client ever saw is the transaction-state probe itself — no
		// hold-gate SELECT, no DELETE/UPDATE ever ran (on a real
		// BEGIN-less client those would have autocommitted).
		const statements = client.query.mock.calls.map((c) => String(c[0]));
		expect(statements.length).toBeGreaterThan(0);
		expect(statements.every((s) => PROBE_SQL.test(s))).toBe(true);
		expect(pool.query).not.toHaveBeenCalled();
	});

	test('control: a client inside BEGIN…COMMIT is not blocked by the guard', async () => {
		const client = makeInTransactionClient();
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result).toBeTruthy();
		expect(client.query).toHaveBeenCalled();
		expect(pool.query).not.toHaveBeenCalled();
	});

	test('an aborted-transaction probe failure (25P02) propagates fail-closed', async () => {
		const client = makeAbortedTransactionClient();
		const err = await erasureService
			.erasePersonalData(7, { client })
			.catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('25P02');
		const statements = client.query.mock.calls.map((c) => String(c[0]));
		expect(statements.every((s) => PROBE_SQL.test(s))).toBe(true);
		expect(pool.query).not.toHaveBeenCalled();
	});

	test('review M1: a RELEASE failure after a successful SAVEPOINT propagates raw, never misread as BEGIN-less', async () => {
		const client = { query: jest.fn() };
		client.query.mockImplementation(async (sql) => {
			if (/^RELEASE SAVEPOINT/i.test(String(sql))) {
				throw pgError('25P01', 'savepoint "erasure_tx_guard_probe" does not exist');
			}
			return { rows: [], rowCount: 1 };
		});
		const err = await erasureService
			.erasePersonalData(7, { client })
			.catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toMatch(/does not exist/);
		expect(err.name).not.toBe('ErasureTransactionRequiredError');
		expect(err.code).not.toBe('ERASURE_TRANSACTION_REQUIRED');
	});

	test('#1343 intact: no client and the pool singleton are still refused before the probe', async () => {
		for (const opts of [undefined, {}, { client: pool }]) {
			const err = await erasureService
				.erasePersonalData(7, opts)
				.catch((e) => e);
			expect(err).toBeInstanceOf(Error);
			expect(err.name).toBe('ErasureTransactionRequiredError');
			expect(err.code).toBe('ERASURE_TRANSACTION_REQUIRED');
		}
		expect(pool.query).not.toHaveBeenCalled();
	});
});
