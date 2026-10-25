/**
 * S-059 (#630): r2FrameStore — encrypted R2 frame storage with per-candidate DEK.
 *
 * AC-1: frames encrypted with candidate DEK before R2 upload
 * AC-3: DEK destruction renders R2 frames unrecoverable
 * AC-4: no plaintext frames written to R2 at any point
 *
 * RED phase: this module does not exist yet.
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
process.env.JWT_SECRET = 'test-jwt-secret-for-r2-frame-store-tests';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const db = require('../../../lib/db');
const fileStorage = require('../../../lib/file-storage');
const { generateDEK, wrapDEK } = require('../../../lib/biometricCrypto');
const {
	uploadEncryptedFrame,
	decryptFrame,
	mintFrameToken,
	verifyFrameToken,
	frameProxyUrl,
	uploadEncryptedFrameForVision,
	ENVELOPE_VERSION,
} = require('../../../lib/r2FrameStore');

// Fake JPEG frame: real magic bytes + random payload
function fakeJpegFrame(size = 2048) {
	return Buffer.concat([
		Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
		crypto.randomBytes(size),
	]);
}

// Queue the two db.query calls getOrCreateDEK makes (INSERT then SELECT).
// The SAME wrapped DEK is returned for a candidate across calls — mirroring
// the real getOrCreateDEK, which converges on one stored DEK row.
const dekCache = new Map();
function testWrappedDEK(candidateId) {
	if (!dekCache.has(candidateId)) {
		dekCache.set(candidateId, wrapDEK(generateDEK(), candidateId));
	}
	return dekCache.get(candidateId);
}
function queueDEK(candidateId, { destroyed = false } = {}) {
	const wrapped = destroyed ? testWrappedDEK(candidateId) : testWrappedDEK(candidateId);
	db.query.mockResolvedValueOnce({ rowCount: 1 });
	db.query.mockResolvedValueOnce({
		rows: [
			{
				dek_encrypted: wrapped,
				destroyed_at: destroyed ? '2026-01-01T00:00:00.000Z' : null,
			},
		],
	});
}
// Decrypt path uses getDEK (select-only, S-059 crypto L1): exactly one query.
function queueExistingDEK(candidateId, { destroyed = false } = {}) {
	const wrapped = testWrappedDEK(candidateId);
	db.query.mockResolvedValueOnce({
		rows: [
			{
				dek_encrypted: wrapped,
				destroyed_at: destroyed ? '2026-01-01T00:00:00.000Z' : null,
			},
		],
	});
}

describe('r2FrameStore', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.FRONTEND_URL;
	});

	describe('uploadEncryptedFrame', () => {
		test('encrypts with the candidate DEK and uploads ciphertext (AC-1)', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame();
			queueDEK(candidateId);

			let uploaded;
			fileStorage.uploadToB2.mockImplementation(async (opts) => {
				uploaded = opts;
				return { url: '/api/files/x', key: 'r2/frames/test.jpg', provider: 'r2' };
			});

			const result = await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });

			expect(result.key).toBe('r2/frames/test.jpg');
			expect(result.proxyUrl).toMatch(/^https?:\/\/.+\/api\/frames\/.+\..+$/);
			expect(uploaded.mimetype).toBe('application/octet-stream'); // not image/jpeg: it's ciphertext
			expect(uploaded.prefix).toBe('frames');
		});

		test('never writes plaintext to R2 (AC-4)', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame(4096);
			queueDEK(candidateId);

			let uploadedBuffer;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				uploadedBuffer = buffer;
				return { url: '/api/files/x', key: 'r2/frames/test.jpg', provider: 'r2' };
			});

			await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });

			// A 64-byte slice of plaintext cannot appear in ciphertext by chance
			expect(uploadedBuffer.indexOf(plaintext.subarray(100, 164))).toBe(-1);
			expect(uploadedBuffer.indexOf(plaintext.subarray(1000, 1064))).toBe(-1);
			// Envelope version byte present
			expect(uploadedBuffer[0]).toBe(ENVELOPE_VERSION);
			// Envelope is larger than plaintext (version + iv + tag overhead)
			expect(uploadedBuffer.length).toBe(plaintext.length + 1 + 12 + 16);
		});

		test('fail-closed: throws when candidateId is missing (AC-4)', async () => {
			await expect(
				uploadEncryptedFrame({ buffer: fakeJpegFrame(), candidateId: null, index: 0 }),
			).rejects.toThrow(/candidateId/i);
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});

		test('fail-closed: encryption failure never uploads plaintext', async () => {
			const candidateId = 42;
			// Simulate DB failure during DEK fetch
			db.query.mockRejectedValueOnce(new Error('db down'));

			await expect(
				uploadEncryptedFrame({ buffer: fakeJpegFrame(), candidateId, index: 0 }),
			).rejects.toThrow();
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});
	});

	describe('decryptFrame (roundtrip)', () => {
		test('decrypts what uploadEncryptedFrame stored', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame();
			queueDEK(candidateId); // encrypt

			let storedKey;
			let storedEnvelope;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				storedEnvelope = buffer;
				storedKey = 'r2/frames/rt.jpg';
				return { url: '/api/files/x', key: storedKey, provider: 'r2' };
			});
			fileStorage.getFile.mockImplementation(async (key) => {
				if (key !== storedKey) {
					const e = new Error('File not found');
					e.code = 'NOT_FOUND';
					e.status = 404;
					throw e;
				}
				return {
					stream: Readable.from([storedEnvelope]),
					contentType: 'application/octet-stream',
					contentLength: storedEnvelope.length,
				};
			});

			const { key } = await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });
			queueExistingDEK(candidateId); // decrypt (select-only)
			const recovered = await decryptFrame(key, candidateId);
			expect(recovered.equals(plaintext)).toBe(true);
		});

		test('tampered ciphertext fails authentication', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame();
			queueDEK(candidateId);

			let storedEnvelope;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				storedEnvelope = buffer;
				return { url: '/api/files/x', key: 'r2/frames/t.jpg', provider: 'r2' };
			});
			await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });

			// Flip a byte in the ciphertext region
			const tampered = Buffer.from(storedEnvelope);
			tampered[tampered.length - 1] ^= 0xff;
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([tampered]),
				contentType: 'application/octet-stream',
				contentLength: tampered.length,
			});

			queueExistingDEK(candidateId);
			await expect(decryptFrame('r2/frames/t.jpg', candidateId)).rejects.toThrow();
		});

		test('wrong candidateId cannot decrypt', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame();
			queueDEK(candidateId);

			let storedEnvelope;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				storedEnvelope = buffer;
				return { url: '/api/files/x', key: 'r2/frames/w.jpg', provider: 'r2' };
			});
			await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });

			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([storedEnvelope]),
				contentType: 'application/octet-stream',
				contentLength: storedEnvelope.length,
			});

			queueExistingDEK(43); // different candidate's DEK
			await expect(decryptFrame('r2/frames/w.jpg', 43)).rejects.toThrow();
		});

		test('destroyed DEK renders frames unrecoverable (AC-3)', async () => {
			const candidateId = 42;
			const plaintext = fakeJpegFrame();
			queueDEK(candidateId);

			let storedEnvelope;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				storedEnvelope = buffer;
				return { url: '/api/files/x', key: 'r2/frames/d.jpg', provider: 'r2' };
			});
			await uploadEncryptedFrame({ buffer: plaintext, candidateId, index: 0 });

			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([storedEnvelope]),
				contentType: 'application/octet-stream',
				contentLength: storedEnvelope.length,
			});

			queueExistingDEK(candidateId, { destroyed: true });
			await expect(decryptFrame('r2/frames/d.jpg', candidateId)).rejects.toThrow(
				/destroyed|crypto-shredded/i,
			);
		});

		test('decrypt path never creates a DEK row (crypto L1)', async () => {
			// getOrCreateDEK does INSERT then SELECT; getDEK does SELECT only.
			const candidateId = 99;
			const wrapped = testWrappedDEK(candidateId);
			db.query.mockResolvedValueOnce({
				rows: [{ dek_encrypted: wrapped, destroyed_at: null }],
			});
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([Buffer.from([ENVELOPE_VERSION, ...crypto.randomBytes(64)])]),
				contentType: 'application/octet-stream',
				contentLength: 65,
			});
			// Envelope is random bytes → GCM auth will fail, but the point is
			// the DEK read issued exactly one SELECT and zero INSERTs.
			await expect(decryptFrame('r2/frames/norow.jpg', candidateId)).rejects.toThrow();
			const inserts = db.query.mock.calls.filter((c) => /INSERT/i.test(c[0]));
			expect(inserts).toHaveLength(0);
			expect(db.query).toHaveBeenCalledTimes(1);
		});

		test('oversized R2 object is rejected before buffering (pentest M-3)', async () => {
			const { MAX_FRAME_BYTES } = require('../../../lib/r2FrameStore');
			// Stream chunks that exceed the cap without allocating 10 MB
			async function* bigStream() {
				yield crypto.randomBytes(1024);
				yield crypto.randomBytes(MAX_FRAME_BYTES); // pushes total over cap
			}
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from(bigStream()),
				contentType: 'application/octet-stream',
				contentLength: MAX_FRAME_BYTES + 1024,
			});
			await expect(decryptFrame('r2/frames/big.jpg', 42)).rejects.toThrow(
				expect.objectContaining({ code: 'FRAME_TOO_LARGE' }),
			);
		});

		test('malformed envelope (bad version) is rejected', async () => {
			const bad = Buffer.concat([Buffer.from([0x99]), crypto.randomBytes(64)]);
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([bad]),
				contentType: 'application/octet-stream',
				contentLength: bad.length,
			});
			await expect(decryptFrame('r2/frames/bad.jpg', 42)).rejects.toThrow(/version|envelope/i);
		});

		test('truncated envelope is rejected', async () => {
			const short = Buffer.from([ENVELOPE_VERSION, 0x01, 0x02]);
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([short]),
				contentType: 'application/octet-stream',
				contentLength: short.length,
			});
			await expect(decryptFrame('r2/frames/short.jpg', 42)).rejects.toThrow(/envelope|length/i);
		});
	});

	describe('frame tokens (AC-2)', () => {
		test('mint → verify roundtrip', () => {
			const token = mintFrameToken('r2/frames/a.jpg', 42);
			const { key, candidateId } = verifyFrameToken(token);
			expect(key).toBe('r2/frames/a.jpg');
			expect(candidateId).toBe(42);
		});

		test('tampered payload is rejected', () => {
			const token = mintFrameToken('r2/frames/a.jpg', 42);
			const [payload, sig] = token.split('.');
			const tamperedPayload = Buffer.from(
				JSON.stringify({ k: 'r2/frames/other.jpg', c: 42, e: Math.floor(Date.now() / 1000) + 600 }),
			).toString('base64url');
			expect(() => verifyFrameToken(`${tamperedPayload}.${sig}`)).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
			);
			expect(payload).toBeDefined();
		});

		test('tampered signature is rejected', () => {
			const token = mintFrameToken('r2/frames/a.jpg', 42);
			const [payload] = token.split('.');
			expect(() => verifyFrameToken(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
			);
		});

		test('expired token is rejected', () => {
			const token = mintFrameToken('r2/frames/a.jpg', 42, -10); // already expired
			expect(() => verifyFrameToken(token)).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_EXPIRED' }),
			);
		});

		test('token for non-frame key is rejected (pentest LOW-1)', () => {
			const token = mintFrameToken('r2/resumes/evil.pdf', 42);
			expect(() => verifyFrameToken(token)).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
			);
		});

		test('malformed token is rejected', () => {
			expect(() => verifyFrameToken('not-a-token')).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
			);
			expect(() => verifyFrameToken('')).toThrow(
				expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
			);
		});

		test('tokens from a different JWT_SECRET do not verify', () => {
			const token = mintFrameToken('r2/frames/a.jpg', 42);
			process.env.JWT_SECRET = 'a-different-secret';
			try {
				expect(() => verifyFrameToken(token)).toThrow(
					expect.objectContaining({ code: 'FRAME_TOKEN_INVALID' }),
				);
			} finally {
				process.env.JWT_SECRET = 'test-jwt-secret-for-r2-frame-store-tests';
			}
		});
	});

	describe('frameProxyUrl', () => {
		test('builds an absolute URL to /api/frames/<token>', () => {
			process.env.FRONTEND_URL = 'https://app.example.com';
			const url = frameProxyUrl('r2/frames/a.jpg', 42);
			expect(url.startsWith('https://app.example.com/api/frames/')).toBe(true);
			const token = url.split('/api/frames/')[1];
			const { key, candidateId } = verifyFrameToken(token);
			expect(key).toBe('r2/frames/a.jpg');
			expect(candidateId).toBe(42);
		});
	});

	describe('uploadEncryptedFrameForVision', () => {
		test('returns proxy URL on success (never throws)', async () => {
			const candidateId = 42;
			queueDEK(candidateId);
			fileStorage.uploadToB2.mockResolvedValue({
				url: '/api/files/x',
				key: 'r2/frames/v.jpg',
				provider: 'r2',
			});
			const b64 = fakeJpegFrame().toString('base64');
			const url = await uploadEncryptedFrameForVision(b64, { candidateId, index: 0 });
			expect(typeof url).toBe('string');
			expect(url).toContain('/api/frames/');
		});

		test('strips data-URI prefix', async () => {
			const candidateId = 42;
			queueDEK(candidateId);
			let uploadedBuffer;
			fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
				uploadedBuffer = buffer;
				return { url: '/api/files/x', key: 'r2/frames/v.jpg', provider: 'r2' };
			});
			const frame = fakeJpegFrame(512);
			const b64 = `data:image/jpeg;base64,${frame.toString('base64')}`;
			await uploadEncryptedFrameForVision(b64, { candidateId, index: 0 });
			// Decrypt what was stored and compare
			fileStorage.getFile.mockResolvedValue({
				stream: Readable.from([uploadedBuffer]),
				contentType: 'application/octet-stream',
				contentLength: uploadedBuffer.length,
			});
			queueExistingDEK(candidateId);
			const recovered = await decryptFrame('r2/frames/v.jpg', candidateId);
			expect(recovered.equals(frame)).toBe(true);
		});

		test('fail-closed: returns null (never plaintext URL) when candidateId missing', async () => {
			const url = await uploadEncryptedFrameForVision(fakeJpegFrame().toString('base64'), {
				candidateId: null,
				index: 0,
			});
			expect(url).toBeNull();
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});

		test('fail-closed: returns null when encryption fails', async () => {
			db.query.mockRejectedValueOnce(new Error('db down'));
			const url = await uploadEncryptedFrameForVision(fakeJpegFrame().toString('base64'), {
				candidateId: 42,
				index: 0,
			});
			expect(url).toBeNull();
			expect(fileStorage.uploadToB2).not.toHaveBeenCalled();
		});
	});
});
