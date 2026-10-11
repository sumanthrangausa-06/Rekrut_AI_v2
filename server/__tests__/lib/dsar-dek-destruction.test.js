/**
 * S-067 (#720): Wire destroyDEK into DSAR and account deletion.
 *
 * RED tests — destroyDEK gains an optional `options` param:
 *   - options.client: pg client/pool used for the UPDATE (transaction support)
 *   - options.audit: { userId, userRole, ipAddress } → writes a biometric_audit_log
 *     'purge' entry on the same client (atomic with the destruction)
 *
 * AC-3: every DEK destruction writes an audit log entry (who/when/why).
 * DEKNotFound → no destruction happened → no audit entry.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const biometricAudit = require('../../../lib/biometricAudit');
const { destroyDEK } = require('../../../lib/biometricCrypto');
const { erasePersonalData } = require('../../../lib/erasureService');

describe('S-067 destroyDEK options (DSAR wiring)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('uses the provided client for the UPDATE (transaction support)', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
		await destroyDEK(7, { client });
		expect(client.query).toHaveBeenCalledTimes(1);
		const [sql, params] = client.query.mock.calls[0];
		expect(sql).toMatch(/UPDATE candidate_data_keys/);
		expect(params[0]).toBe(7);
		// Pool must NOT be touched when a transaction client is given.
		expect(db.query).not.toHaveBeenCalled();
	});

	test('falls back to the default pool when no client is given (backward compat)', async () => {
		db.query.mockResolvedValueOnce({ rowCount: 1 });
		await destroyDEK(7);
		expect(db.query).toHaveBeenCalledTimes(1);
	});

	test('writes a biometric audit purge entry on the same client when audit is provided', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });
		await destroyDEK(7, {
			client,
			audit: { userId: 7, userRole: 'candidate', ipAddress: '10.0.0.1' },
		});
		expect(biometricAudit.logAccess).toHaveBeenCalledTimes(1);
		const [params, passedClient] = biometricAudit.logAccess.mock.calls[0];
		expect(passedClient).toBe(client);
		expect(params).toMatchObject({
			userId: 7,
			userRole: 'candidate',
			action: 'purge',
			dataType: 'dek',
			candidateId: 7,
			ipAddress: '10.0.0.1',
		});
	});

	test('writes no audit entry when audit is not provided', async () => {
		db.query.mockResolvedValueOnce({ rowCount: 1 });
		await destroyDEK(7);
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('DEKNotFound: throws and writes NO audit entry (nothing was destroyed)', async () => {
		const client = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
		const err = await destroyDEK(7, {
			client,
			audit: { userId: 7, userRole: 'candidate' },
		}).catch((e) => e);
		expect(err.code).toBe('DEKNotFound');
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});
});

describe('S-067 erasePersonalData (shared erasure routine)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('returns { shredded: true } and audits when a DEK is destroyed', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 1 }) // destroyDEK UPDATE
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 0 }); // search-index DELETE: no row
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });
		const result = await erasePersonalData(7, {
			client,
			audit: { userId: 7, userRole: 'candidate', ipAddress: '10.0.0.1' },
		});
		expect(result).toEqual({ shredded: true, embeddingsDeleted: false, searchIndexDeleted: false });
		expect(biometricAudit.logAccess).toHaveBeenCalledTimes(1);
	});

	test('returns { shredded: false } on DEKNotFound (no DEK → not an error)', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 0 }) // destroyDEK: DEKNotFound
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 0 }); // search-index DELETE: no row
		const result = await erasePersonalData(7, {
			client,
			audit: { userId: 7, userRole: 'candidate' },
		});
		expect(result).toEqual({ shredded: false, embeddingsDeleted: false, searchIndexDeleted: false });
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('rethrows non-DEKNotFound errors (caller rolls back)', async () => {
		const client = { query: jest.fn().mockRejectedValue(new Error('db down')) };
		await expect(erasePersonalData(7, { client })).rejects.toThrow('db down');
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});
});
