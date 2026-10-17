/**
 * S-059 (#630): frame decrypt-proxy route tests.
 *
 * GET /api/frames/:token — vision APIs fetch frame bytes here.
 * NO session auth: the HMAC-signed token IS the authorization (AC-2).
 * Short-lived capability minted server-side during an authorized upload.
 *
 * AC-2: decryption requires proper authorization (token verification)
 * AC-4: only ciphertext ever touches R2; this endpoint is the sole decryptor
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(),
	getFile: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = 'test-jwt-secret-for-frame-proxy-tests';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const request = require('supertest');
const express = require('express');
const db = require('../../../lib/db');
const fileStorage = require('../../../lib/file-storage');
const { generateDEK, wrapDEK } = require('../../../lib/biometricCrypto');
const {
	mintFrameToken,
	uploadEncryptedFrame,
} = require('../../../lib/r2FrameStore');
const frameProxyRouter = require('../../../server/routes/frame-proxy');

function makeApp() {
	const app = express();
	app.use('/api', frameProxyRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => {
		res.status(500).json({ error: 'Test error handler' });
	});
	return app;
}

function fakeJpegFrame(size = 1024) {
	return Buffer.concat([
		Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
		crypto.randomBytes(size),
	]);
}

// Same wrapped DEK per candidate across calls — mirrors real getOrCreateDEK.
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

describe('GET /api/frames/:token', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	async function setupStoredFrame(candidateId = 42) {
		const plaintext = fakeJpegFrame();
		queueDEK(candidateId);
		let storedEnvelope;
		let storedKey;
		fileStorage.uploadToB2.mockImplementation(async ({ buffer }) => {
			storedEnvelope = buffer;
			storedKey = 'r2/frames/proxy-test.jpg';
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
		const { key } = await uploadEncryptedFrame({
			buffer: plaintext,
			candidateId,
			index: 0,
		});
		return { key, plaintext };
	}

	test('valid token → 200 with decrypted JPEG bytes (AC-2)', async () => {
		const candidateId = 42;
		const { key, plaintext } = await setupStoredFrame(candidateId);
		queueExistingDEK(candidateId); // decrypt (select-only)
		const token = mintFrameToken(key, candidateId);

		const res = await request(makeApp()).get(`/api/frames/${token}`);

		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toMatch(/image\/jpeg/);
		expect(res.headers['cache-control']).toMatch(/no-store/);
		expect(Buffer.from(res.body).equals(plaintext)).toBe(true);
	});

	test('forged signature → 403 (AC-2)', async () => {
		await setupStoredFrame(42);
		const token = mintFrameToken('r2/frames/proxy-test.jpg', 42);
		const [payload] = token.split('.');
		const forged = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

		const res = await request(makeApp()).get(`/api/frames/${forged}`);
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('FRAME_TOKEN_INVALID');
	});

	test('expired token → 403 (AC-2)', async () => {
		await setupStoredFrame(42);
		const token = mintFrameToken('r2/frames/proxy-test.jpg', 42, -5);

		const res = await request(makeApp()).get(`/api/frames/${token}`);
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('FRAME_TOKEN_EXPIRED');
	});

	test('malformed token → 403, no information leak', async () => {
		const res = await request(makeApp()).get('/api/frames/garbage');
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('FRAME_TOKEN_INVALID');
	});

	test('valid token, missing R2 object → 404', async () => {
		const candidateId = 42;
		// NOTE: no queueDEK here — decryptFrame's getFile throws NOT_FOUND
		// before any DB call, so queueing would leak into the next test.
		fileStorage.getFile.mockImplementation(async () => {
			const e = new Error('File not found');
			e.code = 'NOT_FOUND';
			e.status = 404;
			throw e;
		});
		const token = mintFrameToken('r2/frames/does-not-exist.jpg', candidateId);

		const res = await request(makeApp()).get(`/api/frames/${token}`);
		expect(res.status).toBe(404);
	});

	test('valid token after DEK destruction → 403 (AC-3: crypto-shredding)', async () => {
		const candidateId = 42;
		const { key } = await setupStoredFrame(candidateId);
		queueExistingDEK(candidateId, { destroyed: true });
		const token = mintFrameToken(key, candidateId);

		const res = await request(makeApp()).get(`/api/frames/${token}`);
		expect(res.status).toBe(403);
	});

	test('token for another candidate cannot read this frame', async () => {
		const { key, plaintext } = await setupStoredFrame(42);
		// Attacker mints... they can't mint (no secret). Instead: token bound to
		// candidate 43 for the same key — verifyFrameToken passes, decrypt fails.
		// (Minting requires the server secret; this simulates a leaked cross-key token.)
		queueExistingDEK(43);
		const crossToken = mintFrameToken(key, 43);

		const res = await request(makeApp()).get(`/api/frames/${crossToken}`);
		expect(res.status).toBe(403);
		expect(plaintext).toBeDefined();
	});
});
