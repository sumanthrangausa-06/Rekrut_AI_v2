/**
 * S-075 (#752): Hard-delete candidate_embeddings on erasure + rescope the
 * erasure service from biometric-only to personal-data.
 *
 * Privacy-engineer verdict (Rex's specialist review): candidate_embeddings is
 * NOT biometric (1536-dim text embedding of profile/resume text) — zero BIPA
 * exposure — but it IS personal data under GDPR Art. 4(1), and its plaintext
 * survival past account deletion is an active Art. 17 violation.
 * Fix: hard-delete the row on erasure. Embeddings are independent of DEK
 * existence (leaf table, user_id UNIQUE, no FKs pointing at it).
 *
 * RED tests:
 *   - erasePersonalData hard-deletes the candidate_embeddings row
 *   - embeddings DELETE runs even when no DEK exists (independent)
 *   - returns { shredded, embeddingsDeleted } shape
 *   - embeddings DELETE failure propagates (caller rolls back)
 *   - old biometric-only name is gone
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const biometricAudit = require('../../../lib/biometricAudit');
const erasureService = require('../../../lib/erasureService');

describe('S-075 erasePersonalData (renamed + embeddings hard-delete)', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	test('exports erasePersonalData; old biometric-only name is gone', () => {
		expect(typeof erasureService.erasePersonalData).toBe('function');
		expect(erasureService.eraseBiometricData).toBeUndefined();
	});

	test('hard-deletes the candidate_embeddings row for the user', async () => {
		const client = { query: jest.fn() };
		// DEK destroy succeeds, then embeddings DELETE.
		client.query
			.mockResolvedValueOnce({ rowCount: 1 }) // destroyDEK UPDATE
			.mockResolvedValueOnce({ rowCount: 1 }) // embeddings DELETE
			.mockResolvedValueOnce({ rowCount: 1 }); // search-index DELETE
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });

		const result = await erasureService.erasePersonalData(7, {
			client,
			audit: { userId: 7, userRole: 'candidate', ipAddress: '10.0.0.1' },
		});

		const deleteCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM candidate_embeddings/i.test(sql),
		);
		expect(deleteCall).toBeDefined();
		expect(deleteCall[1]).toEqual([7]);
		const searchIndexCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM candidate_search_index/i.test(sql),
		);
		expect(searchIndexCall).toBeDefined();
		expect(searchIndexCall[1]).toEqual([7]);
		expect(result).toEqual({ shredded: true, embeddingsDeleted: true, searchIndexDeleted: true });
	});

	test('embeddings DELETE runs even when no DEK exists (independent)', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 0 }) // destroyDEK: DEKNotFound
			.mockResolvedValueOnce({ rowCount: 1 }) // embeddings DELETE
			.mockResolvedValueOnce({ rowCount: 1 }); // search-index DELETE
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });

		const result = await erasureService.erasePersonalData(7, { client });

		const deleteCall = client.query.mock.calls.find(([sql]) =>
			/DELETE FROM candidate_embeddings/i.test(sql),
		);
		expect(deleteCall).toBeDefined();
		expect(result).toEqual({ shredded: false, embeddingsDeleted: true, searchIndexDeleted: true });
		// No DEK destroyed → no purge audit entry, but embeddings still deleted.
		expect(biometricAudit.logAccess).not.toHaveBeenCalled();
	});

	test('embeddingsDeleted=false when no embeddings row existed', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 1 }) // destroyDEK UPDATE
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 0 }); // search-index DELETE: no row
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });

		const result = await erasureService.erasePersonalData(7, { client });

		expect(result).toEqual({ shredded: true, embeddingsDeleted: false, searchIndexDeleted: false });
	});

	test('embeddings DELETE failure propagates (caller rolls back)', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 1 }) // destroyDEK UPDATE
			.mockRejectedValueOnce(new Error('embeddings delete failed')); // embeddings DELETE fails
		biometricAudit.logAccess.mockResolvedValueOnce({ id: 1 });

		await expect(
			erasureService.erasePersonalData(7, { client }),
		).rejects.toThrow('embeddings delete failed');
	});

	test('search-index DELETE runs even when no embeddings row existed (twin-copy gap)', async () => {
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 0 }) // destroyDEK: DEKNotFound
			.mockResolvedValueOnce({ rowCount: 0 }) // embeddings DELETE: no row
			.mockResolvedValueOnce({ rowCount: 1 }); // search-index DELETE

		const result = await erasureService.erasePersonalData(7, { client });

		expect(result).toEqual({ shredded: false, embeddingsDeleted: false, searchIndexDeleted: true });
	});

	test('embeddings DELETE uses the provided client (transaction support)', async () => {
		const db = require('../../../lib/db');
		const client = { query: jest.fn() };
		client.query
			.mockResolvedValueOnce({ rowCount: 0 }) // DEKNotFound
			.mockResolvedValueOnce({ rowCount: 1 }) // embeddings DELETE
			.mockResolvedValueOnce({ rowCount: 1 }); // search-index DELETE

		await erasureService.erasePersonalData(7, { client });

		// Pool must NOT be touched when a transaction client is given.
		expect(db.query).not.toHaveBeenCalled();
	});
});
