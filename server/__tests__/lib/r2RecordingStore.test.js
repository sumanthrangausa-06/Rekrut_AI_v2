/**
 * S-069 (#722): r2RecordingStore — encrypted R2 recording storage with per-candidate DEKs.
 *
 * AC-1: .webm recordings encrypted with the candidate's DEK before R2 upload
 *       (same AES-256-GCM envelope approach as S-059).
 * AC-2: playback requires authorization + server-side decryption — covered by
 *       the session-auth decrypt-proxy route (tested in interviews routes tests).
 * AC-3: DEK destruction renders recordings unrecoverable (crypto-shredding).
 *
 * Design (STOP 1 approved):
 *  - Reuse S-059's buffer-based encryption (multer limit is 50MB, fine in-memory).
 *  - Separate AAD namespace: `r2recording:v1:candidate:<id>` (NOT r2frame:...) —
 *    cross-type substitution is cryptographically impossible.
 *  - `.enc` suffix + application/octet-stream mimetype distinguish ciphertext
 *    from legacy plaintext `.webm` objects.
 *  - Decrypt path uses decryptWithExistingDEK (no DEK creation on read — S-059 L1).
 *
 * RED phase: lib/r2RecordingStore.js does not exist yet.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(),
	getFile: jest.fn(),
}));

// Must be set before requiring biometricCrypto (fail-secure master key)
process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = 'test-jwt-secret-for-s069';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const db = require('../../../lib/db');
const fileStorage = require('../../../lib/file-storage');
const { generateDEK, wrapDEK } = require('../../../lib/biometricCrypto');
const {
	uploadEncryptedRecording,
	decryptRecording,
	recordingAAD,
	RECORDING_AAD_PREFIX,
	MAX_RECORDING_BYTES,
} = require('../../../lib/r2RecordingStore');

// Fake WebM: EBML header magic bytes + random payload
function fakeWebm(size = 4096) {
	return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(size)]);
}

// Queue the two db.query calls getOrCreateDEK makes (INSERT then SELECT).
const dekCache = new Map();
function testWrappedDEK(candidateId) {
	if (!dekCache.has(candidateId)) {
		dekCache.set(candidateId, wrapDEK(generateDEK(), candidateId));
	}
	return dekCache.get(candidateId);
}
function queueDEK(candidateId, { destroyed = false } = {}) {
	const wrapped = testWrappedDEK(candidateId);
	db.query.mockResolvedValueOnce({ rowCount: 1 });
	db.query.mockResolvedValueOnce({
		rows: [{ dek_encrypted: wrapped, destroyed_at: destroyed ? '2026-01-01T00:00:00.000Z' : null }],
	});
}
// Decrypt path uses getDEK (select-only): exactly one query.
function queueExistingDEK(candidateId, { destroyed = false } = {}) {
	const wrapped = testWrappedDEK(candidateId);
	db.query.mockResolvedValueOnce({
		rows: [{ dek_encrypted: wrapped, destroyed_at: destroyed ? '2026-01-01T00:00:00.000Z' : null }],
	});
}

describe('r2RecordingStore', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('uploadEncryptedRecording', () => {
		test('encrypts with the candidate DEK and uploads ciphertext, never plaintext (AC-1)', async () => {
			const candidateId = 42;
			const plaintext = fakeWebm();
			queueDEK(candidateId);

			let uploaded;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				uploaded = opts;
				return { url: '/api/files/x', key: 'r2/interviews/test.webm.enc', provider: 'r2' };
			});

			const result = await uploadEncryptedRecording({
				buffer: plaintext,
				candidateId,
				interviewId: 7,
				questionIndex: 2,
			});

			expect(result.key).toBe('r2/interviews/test.webm.enc');
			// Ciphertext uploaded, not the plaintext WebM
			expect(uploaded.buffer.equals(plaintext)).toBe(false);
			expect(uploaded.buffer[0]).toBe(0x01); // envelope version
			expect(uploaded.mimetype).toBe('application/octet-stream');
			expect(uploaded.prefix).toBe('interviews');
		});

		test('uses .enc suffix to distinguish from legacy plaintext .webm', async () => {
			const candidateId = 42;
			queueDEK(candidateId);

			let uploaded;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				uploaded = opts;
				return { url: '/api/files/x', key: 'r2/interviews/test.webm.enc', provider: 'r2' };
			});

			await uploadEncryptedRecording({
				buffer: fakeWebm(),
				candidateId,
				interviewId: 7,
				questionIndex: 0,
			});

			expect(uploaded.filename.endsWith('.enc')).toBe(true);
			expect(uploaded.filename).not.toMatch(/\.webm$/);
		});

		test('fail-closed: missing candidateId throws, nothing uploaded', async () => {
			await expect(
				uploadEncryptedRecording({ buffer: fakeWebm(), interviewId: 1, questionIndex: 0 }),
			).rejects.toThrow();
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});

		test('fail-closed: empty buffer throws, nothing uploaded', async () => {
			await expect(
				uploadEncryptedRecording({
					buffer: Buffer.alloc(0),
					candidateId: 42,
					interviewId: 1,
					questionIndex: 0,
				}),
			).rejects.toThrow();
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});

		test('uses a separate AAD namespace from frames (no cross-type substitution)', async () => {
			expect(RECORDING_AAD_PREFIX).not.toContain('r2frame');
			expect(recordingAAD(42, 7, 0)).toBe('r2recording:v1:candidate:42:interview:7:q:0');
			expect(recordingAAD(42, 7, 0)).not.toBe('r2frame:v1:candidate:42');
		});

		test('AAD binds interview and question — same candidate, different question differs (crypto H1)', async () => {
			expect(recordingAAD(42, 7, 0)).not.toBe(recordingAAD(42, 7, 1));
			expect(recordingAAD(42, 7, 0)).not.toBe(recordingAAD(42, 8, 0));
		});

		test('fail-closed: oversized plaintext buffer throws (crypto L2)', async () => {
			const { MAX_PLAINTEXT_BYTES } = require('../../../lib/r2RecordingStore');
			await expect(
				uploadEncryptedRecording({
					buffer: Buffer.alloc(MAX_PLAINTEXT_BYTES + 1),
					candidateId: 42,
					interviewId: 1,
					questionIndex: 0,
				}),
			).rejects.toThrow(/exceeds/);
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});

		test('fail-closed: missing interviewId/questionIndex throws (AAD binding required)', async () => {
			await expect(
				uploadEncryptedRecording({ buffer: fakeWebm(), candidateId: 42 }),
			).rejects.toThrow(/interviewId/);
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});
	});

	describe('decryptRecording', () => {
		test('round-trips: decrypt(upload(plaintext)) === plaintext', async () => {
			const candidateId = 42;
			const plaintext = fakeWebm(8192);
			queueDEK(candidateId);

			let stored;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				stored = opts.buffer;
				return { url: '/api/files/x', key: 'r2/interviews/rt.webm.enc', provider: 'r2' };
			});
			await uploadEncryptedRecording({
				buffer: plaintext,
				candidateId,
				interviewId: 1,
				questionIndex: 0,
			});

			queueExistingDEK(candidateId);
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([stored]),
				contentType: 'application/octet-stream',
				contentLength: stored.length,
			});

			const decrypted = await decryptRecording('r2/interviews/rt.webm.enc', candidateId, 1, 0);
			expect(decrypted.equals(plaintext)).toBe(true);
		});

		test('DEK destruction renders the recording unrecoverable (AC-3, crypto-shredding)', async () => {
			const candidateId = 42;
			const plaintext = fakeWebm();
			queueDEK(candidateId);

			let stored;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				stored = opts.buffer;
				return { url: '/api/files/x', key: 'r2/interviews/shred.webm.enc', provider: 'r2' };
			});
			await uploadEncryptedRecording({
				buffer: plaintext,
				candidateId,
				interviewId: 1,
				questionIndex: 0,
			});

			// DEK destroyed → getDEK throws
			queueExistingDEK(candidateId, { destroyed: true });
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([stored]),
				contentType: 'application/octet-stream',
				contentLength: stored.length,
			});

			await expect(decryptRecording('r2/interviews/shred.webm.enc', candidateId, 1, 0)).rejects.toThrow(
				/destroyed/i,
			);
		});

		test('cross-question replay fails GCM auth (crypto H1 — answer replay blocked)', async () => {
			const candidateId = 42;
			const plaintext = fakeWebm();
			queueDEK(candidateId);

			let stored;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				stored = opts.buffer;
				return { url: '/api/files/x', key: 'r2/interviews/replay.webm.enc', provider: 'r2' };
			});
			// Uploaded as Q0...
			await uploadEncryptedRecording({
				buffer: plaintext,
				candidateId,
				interviewId: 1,
				questionIndex: 0,
			});

			// ...replayed as Q1 → GCM auth fails (AAD mismatch)
			queueExistingDEK(candidateId);
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([stored]),
				contentType: 'application/octet-stream',
				contentLength: stored.length,
			});
			await expect(
				decryptRecording('r2/interviews/replay.webm.enc', candidateId, 1, 1),
			).rejects.toThrow();
		});

		test('refuses to decrypt keys outside the interviews/ prefix', async () => {
			await expect(decryptRecording('r2/frames/evil.bin', 42)).rejects.toThrow();
			await expect(decryptRecording('r2/resumes/evil.pdf', 42)).rejects.toThrow();
			expect(fileStorage.getFile).not.toHaveBeenCalled();
		});

		test('rejects oversized envelopes (memory bound)', async () => {
			const candidateId = 42;
			queueExistingDEK(candidateId);
			const huge = Buffer.alloc(MAX_RECORDING_BYTES + 1);
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([huge]),
				contentType: 'application/octet-stream',
				contentLength: huge.length,
			});
			await expect(decryptRecording('r2/interviews/huge.webm.enc', candidateId, 1, 0)).rejects.toThrow(
				/exceeds/,
			);
		});

		test('fail-closed: missing candidateId throws before any storage read', async () => {
			await expect(decryptRecording('r2/interviews/x.webm.enc', null)).rejects.toThrow();
			expect(fileStorage.getFile).not.toHaveBeenCalled();
		});
	});
});
