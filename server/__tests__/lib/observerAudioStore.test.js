/**
 * r2ObserverAudioStore + observerAudioTestDecrypt — Gate A (S-085 #787).
 * Encryption-before-PUT, AAD binding, decrypt isolation (P-21), and the
 * T8b essence: after DEK destruction, capture/decrypt create NOTHING.
 */
const { Readable } = require('node:stream');

const dekRows = new Map();
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params = []) => {
		if (sql.includes('INSERT INTO candidate_data_keys')) {
			if (!dekRows.has(params[0])) dekRows.set(params[0], { dek_encrypted: params[1], destroyed_at: null });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes('SELECT dek_encrypted, destroyed_at FROM candidate_data_keys')) {
			const row = dekRows.get(params[0]);
			return { rows: row ? [row] : [] };
		}
		if (sql.includes('UPDATE candidate_data_keys')) {
			const row = dekRows.get(params[0]);
			if (!row) return { rows: [], rowCount: 0 };
			row.destroyed_at = new Date();
			row.dek_encrypted = params[1];
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes('SELECT destroyed_at FROM candidate_data_keys')) {
			const row = dekRows.get(params[0]);
			return { rows: row ? [{ destroyed_at: row.destroyed_at }] : [] };
		}
		throw new Error('unstubbed SQL: ' + sql.slice(0, 60));
	}),
}));
jest.mock('../../../lib/biometricAudit', () => ({ logAccess: jest.fn(async () => {}) }));

const objects = new Map();
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async ({ buffer, objectKey }) => {
		const key = `r2/${objectKey}`;
		objects.set(key, Buffer.from(buffer));
		return { key, url: `/api/files/${encodeURIComponent(key)}`, provider: 'r2' };
	}),
	getFile: jest.fn(async (key) => {
		if (!objects.has(key)) { const e = new Error('not found'); e.code = 'NOT_FOUND'; throw e; }
		return { stream: Readable.from([objects.get(key)]) };
	}),
	deleteStorageObject: jest.fn(async (key) => { objects.delete(key); return { deleted: true }; }),
	deleteFile: jest.fn(async () => ({ deleted: true })),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY = 'a'.repeat(64);

const store = require('../../../lib/r2ObserverAudioStore');
const testDecrypt = require('../../../lib/observerAudioTestDecrypt');
const biometricCrypto = require('../../../lib/biometricCrypto');

const pcm = Buffer.alloc(9600);
for (let i = 0; i < pcm.length; i++) pcm[i] = i % 251;

describe('r2ObserverAudioStore', () => {
	test('PUT encrypts first: opaque key, ciphertext-only storage, envelope size', async () => {
		const { key, byteSize } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		expect(key).toMatch(/^r2\/observer-audio-test\/audio-[0-9a-f]{16}\.enc$/);
		expect(byteSize).toBe(pcm.length + 29);
		const stored = objects.get(key);
		expect(stored.equals(pcm)).toBe(false);
		expect(stored.includes(pcm.subarray(100, 200))).toBe(false);
	});

	test('activation scope uses the activation prefix', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 1, bareKey: store.generateChunkKey('activation') });
		expect(key).toMatch(/^r2\/observer-audio\/audio-[0-9a-f]{16}\.enc$/);
	});

	test('fail-closed validation', async () => {
		await expect(store.putEncryptedChunkAtKey({ pcmBuffer: Buffer.alloc(0), candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') })).rejects.toMatchObject({ code: 'INVALID_CHUNK' });
		await expect(store.putEncryptedChunkAtKey({ pcmBuffer: pcm, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') })).rejects.toMatchObject({ code: 'CANDIDATE_REQUIRED' });
		expect(() => store.generateChunkKey('bogus')).toThrow(expect.objectContaining({ code: 'INVALID_SCOPE' }));
	});

	test('the store exports NO decrypt function (P-21)', () => {
		expect(Object.keys(store).some((k) => /decrypt/i.test(k))).toBe(false);
	});

	test('delete helper refuses keys outside the observer prefixes', async () => {
		await expect(store.deleteObserverAudioObject('r2/interviews/recording-x.enc')).rejects.toMatchObject({ code: 'INVALID_KEY' });
	});
});

describe('observerAudioTestDecrypt (isolated)', () => {
	test('round-trips a test chunk', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		const back = await testDecrypt.decryptTestChunk(key, 7, 42, 0);
		expect(back.equals(pcm)).toBe(true);
	});

	test('AAD binding: wrong chunk/session/candidate all fail authentication', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		await expect(testDecrypt.decryptTestChunk(key, 7, 42, 1)).rejects.toThrow();
		await expect(testDecrypt.decryptTestChunk(key, 7, 43, 0)).rejects.toThrow();
		await expect(testDecrypt.decryptTestChunk(key, 8, 42, 0)).rejects.toThrow();
	});

	test('activation keys have NO decrypt path', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 2, bareKey: store.generateChunkKey('activation') });
		await expect(testDecrypt.decryptTestChunk(key, 7, 42, 2)).rejects.toMatchObject({ code: 'TEST_DECRYPT_FORBIDDEN' });
	});

	test('UNKNOWN env identity also refuses (M-2: the guard is an allowlist, not a production check)', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		const saved = process.env.REKRUT_ENV_IDENTITY;
		process.env.REKRUT_ENV_IDENTITY = 'unrecognised-value';
		try {
			await expect(testDecrypt.decryptTestChunk(key, 7, 42, 0)).rejects.toMatchObject({ code: 'TEST_DECRYPT_FORBIDDEN' });
		} finally {
			if (saved === undefined) delete process.env.REKRUT_ENV_IDENTITY; else process.env.REKRUT_ENV_IDENTITY = saved;
		}
	});

	test('production env identity refuses even test keys', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 7, sessionId: 42, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		process.env.REKRUT_ENV_IDENTITY = 'production';
		try {
			await expect(testDecrypt.decryptTestChunk(key, 7, 42, 0)).rejects.toMatchObject({ code: 'TEST_DECRYPT_FORBIDDEN' });
		} finally {
			delete process.env.REKRUT_ENV_IDENTITY;
		}
	});

	test('T8b: after DEK destruction, a capture attempt creates ZERO new DEKs and ZERO chunks', async () => {
		const { key } = await store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 9, sessionId: 1, chunkIndex: 0, bareKey: store.generateChunkKey('test') });
		await biometricCrypto.destroyDEK(9);
		const dekCountBefore = dekRows.size;
		// Decrypt refuses (destroyed) and must not recreate key material
		await expect(testDecrypt.decryptTestChunk(key, 9, 1, 0)).rejects.toThrow(/destroyed/);
		// A fresh capture attempt for the erased candidate also refuses —
		// getOrCreateDEK throws on the destroyed row instead of resurrecting it
		await expect(store.putEncryptedChunkAtKey({ pcmBuffer: pcm, candidateId: 9, sessionId: 2, chunkIndex: 0, bareKey: store.generateChunkKey('test') })).rejects.toThrow(/destroyed/);
		expect(dekRows.size).toBe(dekCountBefore);
		expect(dekRows.get(9).destroyed_at).not.toBeNull();
	});
});
