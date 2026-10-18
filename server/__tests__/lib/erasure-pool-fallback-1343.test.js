/**
 * #1343: erasePersonalData's pool fallback voids the #1337 fail-closed
 * drain semantics.
 *
 * erasePersonalData (lib/erasureService.js) falls back to the global
 * pool when no client is passed (`client || require('./db')`). On the
 * pool every statement autocommits, so when the #1337 dead-letter drain
 * throws ComplianceAuditDrainError there is no transaction to roll
 * back: writes before the drain have already committed and the erasure
 * is partial instead of atomic. Both production callers
 * (routes/auth.js self-serve, routes/admin.js DSAR) pass a client
 * inside BEGIN...COMMIT today, so this is latent — the fix makes the
 * void path impossible: erasePersonalData must require a transaction
 * client and refuse, before touching any data, when none is supplied.
 *
 * Mocked evidence only here; the real-DB proof is recorded in the PR.
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

function makeClient() {
	const client = { query: jest.fn() };
	client.query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
	return client;
}

describe('#1343 erasePersonalData — transaction client is required (no pool fallback)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
	});

	test.each([
		['no options argument', undefined],
		['empty options', {}],
		['client: undefined', { client: undefined }],
		['client: null', { client: null }],
		// The guard's second clause: a present but query-less "client".
		['client without query', { client: {} }],
		['client with non-function query', { client: { query: 1 } }],
		['client as a string', { client: 'x' }],
		// Review HIGH (#1343): the lib/db pool singleton itself — a Pool
		// HAS .query, so shape alone would let the autocommit void back
		// in. `pool` here is the (mocked) lib/db module, the same object
		// erasureService would receive in production.
		['the pool itself as client', { client: pool }],
	])('rejects fail-closed when called with %s, and never touches the pool', async (_label, opts) => {
		const err = await erasureService.erasePersonalData(7, opts).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('ErasureTransactionRequiredError');
		expect(err.code).toBe('ERASURE_TRANSACTION_REQUIRED');
		// Fail-closed BEFORE any data access: the pool must not be used
		// for the hold gate, the drain, or any delete.
		expect(pool.query).not.toHaveBeenCalled();
	});

	test('control: a caller-supplied query-capable client is not blocked by the guard (mocked shape check only — the real transactional path is proven by the real-DB E2E in the PR)', async () => {
		const client = makeClient();
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result).toBeTruthy();
		expect(client.query).toHaveBeenCalled();
		expect(pool.query).not.toHaveBeenCalled();
	});
});
