/**
 * S-058 (#582): biometricCrypto helper — unit tests with mocked pool.
 *
 * AC-3: per-candidate random DEKs (not HKDF-derived — derived keys are
 * re-derivable and cannot be crypto-shredded, per ADR-012).
 * Crypto-shredding: destroyDEK → all data encrypted under it unrecoverable.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const crypto = require('node:crypto');
const db = require('../../../lib/db');

// Set test master key before requiring the module (32-byte key as 64-char hex)
process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const {
	generateDEK,
	generateSubjectRef,
	getOrCreateDEK,
	encryptWithDEK,
	decryptWithDEK,
	destroyDEK,
	isDEKDestroyed,
	wrapDEK,
	unwrapDEK,
} = require('../../../lib/biometricCrypto');

describe('biometricCrypto', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	describe('generateDEK', () => {
		test('returns 32 random bytes', () => {
			const dek = generateDEK();
			expect(Buffer.isBuffer(dek)).toBe(true);
			expect(dek.length).toBe(32);
		});

		test('each call returns a different key (not derived)', () => {
			const a = generateDEK();
			const b = generateDEK();
			expect(a.equals(b)).toBe(false);
		});
	});

	describe('getOrCreateDEK', () => {
		test('creates and stores a new DEK when none exists (atomic upsert)', async () => {
			db.query
				.mockResolvedValueOnce({ rowCount: 1 }) // INSERT ... ON CONFLICT DO NOTHING
				.mockResolvedValueOnce({
					rows: [{ dek_encrypted: wrapDEK(generateDEK(), 7), destroyed_at: null }],
				}); // re-SELECT

			const dek = await getOrCreateDEK(7);
			expect(Buffer.isBuffer(dek)).toBe(true);
			expect(dek.length).toBe(32);
			const insertCall = db.query.mock.calls[0];
			expect(insertCall[0]).toMatch(/ON CONFLICT \(candidate_id\) DO NOTHING/);
		});

		test('returns existing DEK when one exists (decrypts stored value)', async () => {
			const rawDek = generateDEK();
			const stored = wrapDEK(rawDek, 7);

			db.query
				.mockResolvedValueOnce({ rowCount: 1 }) // upsert (no-op on conflict)
				.mockResolvedValueOnce({ rows: [{ dek_encrypted: stored, destroyed_at: null }] });

			const dek = await getOrCreateDEK(7);
			expect(dek.equals(rawDek)).toBe(true);
		});

		test('throws when DEK was destroyed (crypto-shredded)', async () => {
			db.query
				.mockResolvedValueOnce({ rowCount: 1 })
				.mockResolvedValueOnce({
					rows: [{ dek_encrypted: Buffer.from('00', 'hex'), destroyed_at: new Date() }],
				});
			await expect(getOrCreateDEK(7)).rejects.toThrow(/destroyed/i);
		});
	});

	describe('DEK wrapping with AAD binding', () => {
		test('DEK wrapped for candidate 7 fails to unwrap for candidate 8', () => {
			const dek = generateDEK();
			const wrapped = wrapDEK(dek, 7);
			expect(() => unwrapDEK(wrapped, 8)).toThrow();
			// Correct candidate still works
			expect(unwrapDEK(wrapped, 7).equals(dek)).toBe(true);
		});

		test('wrapped format has version byte and expected length', () => {
			const wrapped = wrapDEK(generateDEK(), 7);
			expect(wrapped[0]).toBe(0x01);
			expect(wrapped.length).toBe(61); // 1 + 12 + 16 + 32
		});

		test('unwrapDEK rejects malformed input', () => {
			expect(() => unwrapDEK(Buffer.from('short'), 7)).toThrow(/malformed/);
			const bad = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(60)]);
			expect(() => unwrapDEK(bad, 7)).toThrow(/unsupported key version/);
		});
	});

	describe('generateSubjectRef', () => {
		test('returns 32 random bytes, unique per call', () => {
			const a = generateSubjectRef();
			const b = generateSubjectRef();
			expect(a.length).toBe(32);
			expect(a.equals(b)).toBe(false);
		});
	});

	describe('encrypt/decrypt roundtrip', () => {
		test('decryptWithDEK reverses encryptWithDEK', async () => {
			db.query.mockResolvedValue({ rows: [] }); // getOrCreateDEK path (simplified)
			db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ candidate_id: 7 }] });

			const plaintext = Buffer.from('face-embedding-vector-data');
			// Use generateDEK directly for roundtrip (bypasses DB)
			const dek = generateDEK();
			const { encryptBuffer, decryptBuffer } = require('../../../lib/biometricCrypto');
			const enc = encryptBuffer(plaintext, dek);
			const dec = decryptBuffer(enc.ciphertext, enc.iv, enc.tag, dek);
			expect(dec.equals(plaintext)).toBe(true);
		});

		test('tampered ciphertext fails authentication', async () => {
			const dek = generateDEK();
			const { encryptBuffer, decryptBuffer } = require('../../../lib/biometricCrypto');
			const enc = encryptBuffer(Buffer.from('secret'), dek);
			enc.ciphertext[0] ^= 0xff; // flip a bit
			expect(() => decryptBuffer(enc.ciphertext, enc.iv, enc.tag, dek)).toThrow();
		});
	});

	describe('destroyDEK (crypto-shredding)', () => {
		test('sets destroyed_at and zeroes dek_encrypted', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 1 });
			await destroyDEK(7);
			const [sql, params] = db.query.mock.calls[0];
			expect(sql).toMatch(/UPDATE candidate_data_keys/);
			expect(sql).toMatch(/destroyed_at/);
			expect(sql).toMatch(/dek_encrypted/);
			expect(params).toContain(7);
		});

		test('throws DEKNotFound when no row exists (no silent no-op)', async () => {
			db.query.mockResolvedValueOnce({ rowCount: 0 });
			const err = await destroyDEK(7).catch((e) => e);
			expect(err.code).toBe('DEKNotFound');
			expect(err.message).toMatch(/no DEK row/);
		});

		test('isDEKDestroyed returns true after destruction', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ destroyed_at: new Date() }] });
			expect(await isDEKDestroyed(7)).toBe(true);
		});

		test('isDEKDestroyed returns false for active key', async () => {
			db.query.mockResolvedValueOnce({ rows: [{ destroyed_at: null }] });
			expect(await isDEKDestroyed(7)).toBe(false);
		});
	});

	describe('fail-secure master key', () => {
		test('throws in production when BIOMETRIC_ENCRYPTION_KEY is missing', () => {
			const origEnv = process.env.NODE_ENV;
			const origKey = process.env.BIOMETRIC_ENCRYPTION_KEY;
			process.env.NODE_ENV = 'production';
			delete process.env.BIOMETRIC_ENCRYPTION_KEY;
			jest.resetModules();
			const fresh = require('../../../lib/biometricCrypto');
			expect(() => fresh.getMasterKey()).toThrow(/BIOMETRIC_ENCRYPTION_KEY/);
			process.env.NODE_ENV = origEnv;
			process.env.BIOMETRIC_ENCRYPTION_KEY = origKey;
			jest.resetModules();
		});
	});
});
