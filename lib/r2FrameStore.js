/**
 * r2FrameStore — Encrypted R2 frame storage with per-candidate DEKs (S-059 #630).
 *
 * Problem (P0 launch-blocker): raw face frames were uploaded to R2 with no
 * encryption, bypassing S-058's crypto-shredding design. This module is the
 * single choke point for frame uploads: every frame is encrypted with the
 * candidate's DEK (via lib/biometricCrypto.js) BEFORE the R2 PUT. There is
 * no plaintext path.
 *
 * Design:
 *  - Envelope (self-describing, versioned): 0x01 || iv(12) || tag(16) || ciphertext
 *    AES-256-GCM via biometricCrypto. AAD binds the candidate:
 *    `r2frame:v1:candidate:<candidateId>` (cross-candidate substitution is
 *    cryptographically impossible — the DEK is per-candidate).
 *  - Stored mimetype is application/octet-stream (ciphertext, not a JPEG).
 *  - Vision APIs cannot fetch ciphertext, so the upload returns a short-lived
 *    decrypt-proxy URL: <base>/api/frames/<token>. The token is an HMAC-signed
 *    capability ({key, candidateId, exp}) — unforgeable, 10-minute TTL, bound
 *    to one frame and one candidate. The proxy endpoint verifies the token,
 *    decrypts with the candidate DEK, and streams plaintext JPEG with
 *    Cache-Control: no-store. No session cookie needed: the token IS the
 *    authorization (AC-2), minted server-side inside an authenticated request.
 *  - DEK destruction (crypto-shredding) renders every stored frame
 *    unrecoverable: decryptFrame throws and the proxy returns 403 (AC-3).
 *  - Fail-closed: missing candidateId or any crypto/storage failure throws
 *    (or returns null in the vision helper) — plaintext is NEVER uploaded.
 *
 * Security notes for reviewers:
 *  - The HMAC key is derived from JWT_SECRET with a purpose string, so a
 *    compromise of frame tokens does not affect session JWTs and vice versa.
 *  - Proxy tokens (10 min) are strictly shorter-lived than the old R2
 *    presigned URLs (1 hour) they replace.
 */

const crypto = require('node:crypto');
const { uploadToB2, getFile } = require('./file-storage');
const { encryptWithDEK, decryptWithExistingDEK } = require('./biometricCrypto');

const ENVELOPE_VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const ENVELOPE_OVERHEAD = 1 + IV_LEN + TAG_LEN; // 29 bytes
const TOKEN_TTL_SEC = 600; // 10 minutes — vision consumes the URL immediately
const FRAME_AAD_PREFIX = 'r2frame:v1:candidate:';
const PROXY_KEY_PURPOSE = 'r2-frame-proxy-v1';
// Pentest M-3: bound the memory held while buffering an R2 object for decrypt.
// Frames are ~320x240 JPEGs (tens of KB); 10 MB is generous headroom.
const MAX_FRAME_BYTES = 10 * 1024 * 1024;
// Pentest LOW-1: tokens may only reference frame objects, never other prefixes.
const FRAME_KEY_RE = /^(b2|r2)\/frames\//;

function _codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/** AAD binds ciphertext to the candidate. DEK is already per-candidate. */
function frameAAD(candidateId) {
	return `${FRAME_AAD_PREFIX}${candidateId}`;
}

/** Pack {iv, tag, ciphertext} into the versioned envelope. */
function packEnvelope({ iv, tag, ciphertext }) {
	if (!Buffer.isBuffer(iv) || iv.length !== IV_LEN) {
		throw _codedError('ENVELOPE_ERROR', `r2FrameStore: iv must be ${IV_LEN} bytes`);
	}
	if (!Buffer.isBuffer(tag) || tag.length !== TAG_LEN) {
		throw _codedError('ENVELOPE_ERROR', `r2FrameStore: tag must be ${TAG_LEN} bytes`);
	}
	return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, ciphertext]);
}

/** Unpack and validate the envelope. Throws on version/length mismatch. */
function unpackEnvelope(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < ENVELOPE_OVERHEAD + 1) {
		throw _codedError('ENVELOPE_ERROR', 'r2FrameStore: envelope too short');
	}
	if (buf[0] !== ENVELOPE_VERSION) {
		throw _codedError(
			'ENVELOPE_ERROR',
			`r2FrameStore: unsupported envelope version 0x${buf[0].toString(16)}`,
		);
	}
	return {
		iv: buf.subarray(1, 1 + IV_LEN),
		tag: buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN),
		ciphertext: buf.subarray(1 + IV_LEN + TAG_LEN),
	};
}

/** Purpose-bound HMAC key derived from the server JWT secret. */
function proxySigningKey() {
	const jwtSecret = process.env.JWT_SECRET;
	if (!jwtSecret) {
		throw _codedError('CONFIG_ERROR', 'r2FrameStore: JWT_SECRET environment variable is required');
	}
	return crypto.createHmac('sha256', jwtSecret).update(PROXY_KEY_PURPOSE).digest();
}

/**
 * Mint a short-lived capability token for one frame.
 * @param {string} objectKey provider-prefixed R2 key (e.g. "r2/frames/....jpg")
 * @param {number|string} candidateId
 * @param {number} [ttlSec] token lifetime in seconds (default 600)
 * @returns {string} base64url(payload).base64url(signature)
 */
function mintFrameToken(objectKey, candidateId, ttlSec = TOKEN_TTL_SEC) {
	if (!objectKey || typeof objectKey !== 'string') {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: objectKey is required');
	}
	if (candidateId == null) {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: candidateId is required');
	}
	const payload = Buffer.from(
		JSON.stringify({
			k: objectKey,
			c: candidateId,
			e: Math.floor(Date.now() / 1000) + ttlSec,
		}),
		'utf8',
	).toString('base64url');
	const sig = crypto.createHmac('sha256', proxySigningKey()).update(payload).digest('base64url');
	return `${payload}.${sig}`;
}

/**
 * Verify a frame token. Returns {key, candidateId}.
 * @throws FRAME_TOKEN_INVALID on malformed/forged tokens
 * @throws FRAME_TOKEN_EXPIRED on expired tokens
 */
function verifyFrameToken(token) {
	if (!token || typeof token !== 'string') {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: token is required');
	}
	const dot = token.indexOf('.');
	if (dot === -1) {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: malformed token');
	}
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: malformed token payload');
	}
	if (!parsed || typeof parsed.k !== 'string' || parsed.c == null || typeof parsed.e !== 'number') {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: malformed token payload');
	}
	if (!FRAME_KEY_RE.test(parsed.k)) {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: token key is not a frame object');
	}
	const expectedSig = crypto
		.createHmac('sha256', proxySigningKey())
		.update(payload)
		.digest('base64url');
	const sigBuf = Buffer.from(sig, 'base64url');
	const expectedBuf = Buffer.from(expectedSig, 'base64url');
	if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
		throw _codedError('FRAME_TOKEN_INVALID', 'r2FrameStore: invalid token signature');
	}
	if (parsed.e < Math.floor(Date.now() / 1000)) {
		throw _codedError('FRAME_TOKEN_EXPIRED', 'r2FrameStore: token expired');
	}
	return { key: parsed.k, candidateId: parsed.c };
}

/** Absolute decrypt-proxy URL for a frame (what vision APIs fetch). */
function frameProxyUrl(objectKey, candidateId, ttlSec) {
	const base = process.env.FRONTEND_URL || 'https://rekrutai.co';
	return `${base}/api/frames/${mintFrameToken(objectKey, candidateId, ttlSec)}`;
}

async function streamToBuffer(stream) {
	const chunks = [];
	let total = 0;
	for await (const chunk of stream) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > MAX_FRAME_BYTES) {
			throw _codedError('FRAME_TOO_LARGE', `r2FrameStore: frame exceeds ${MAX_FRAME_BYTES} bytes`);
		}
		chunks.push(buf);
	}
	return Buffer.concat(chunks);
}

/**
 * Encrypt a frame buffer and upload the ciphertext envelope to R2.
 * FAIL-CLOSED: throws on missing candidateId or any crypto/storage failure.
 * Plaintext is never uploaded.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer raw frame bytes (e.g. JPEG)
 * @param {number|string} opts.candidateId owner of the DEK
 * @param {number} [opts.index] frame index (for filename only)
 * @returns {Promise<{key: string, proxyUrl: string}>}
 */
async function uploadEncryptedFrame({ buffer, candidateId, index = 0 }) {
	if (candidateId == null) {
		throw _codedError('CANDIDATE_REQUIRED', 'r2FrameStore: candidateId is required (fail-closed)');
	}
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		throw _codedError('INVALID_FRAME', 'r2FrameStore: buffer must be a non-empty Buffer');
	}
	// Encrypt FIRST — the R2 PUT only ever sees ciphertext (AC-1, AC-4).
	const { ciphertext, iv, tag } = await encryptWithDEK(buffer, candidateId, frameAAD(candidateId));
	const envelope = packEnvelope({ iv, tag, ciphertext });

	const result = await uploadToB2({
		buffer: envelope,
		mimetype: 'application/octet-stream', // ciphertext, not an image
		// Privacy L-1: random names — no capture timestamps in R2 object keys.
		filename: `video-frame-${crypto.randomBytes(8).toString('hex')}.bin`,
		prefix: 'frames',
	});
	return { key: result.key, proxyUrl: frameProxyUrl(result.key, candidateId) };
}

/**
 * Fetch a stored frame envelope from R2 and decrypt it.
 * Throws when the DEK was destroyed (crypto-shredding, AC-3), the envelope
 * is malformed/tampered, or the candidate does not own the DEK.
 *
 * @param {string} objectKey provider-prefixed R2 key
 * @param {number|string} candidateId
 * @returns {Promise<Buffer>} plaintext frame bytes
 */
async function decryptFrame(objectKey, candidateId) {
	if (candidateId == null) {
		throw _codedError('CANDIDATE_REQUIRED', 'r2FrameStore: candidateId is required (fail-closed)');
	}
	const { stream } = await getFile(objectKey);
	const envelope = await streamToBuffer(stream);
	const { iv, tag, ciphertext } = unpackEnvelope(envelope);
	// Crypto L1: select-only DEK read — a decrypt must never create key material.
	return decryptWithExistingDEK(ciphertext, iv, tag, candidateId, frameAAD(candidateId));
}

/**
 * Vision call-site helper: base64 frame → encrypted upload → proxy URL.
 * Never throws and never returns a plaintext URL: any failure returns null
 * so callers fall back to text-based analysis (fail-closed, AC-4).
 *
 * @param {string} base64Data frame as base64 (data-URI prefix optional)
 * @param {object} opts
 * @param {number|string} opts.candidateId
 * @param {number} [opts.index]
 * @returns {Promise<string|null>} decrypt-proxy URL or null
 */
async function uploadEncryptedFrameForVision(base64Data, { candidateId, index = 0 } = {}) {
	try {
		if (candidateId == null) {
			throw _codedError(
				'CANDIDATE_REQUIRED',
				'r2FrameStore: candidateId is required for frame upload (fail-closed)',
			);
		}
		const raw = String(base64Data || '').replace(/^data:image\/\w+;base64,/, '');
		const buffer = Buffer.from(raw, 'base64');
		if (buffer.length === 0) {
			throw _codedError('INVALID_FRAME', 'r2FrameStore: empty frame data');
		}
		const { proxyUrl } = await uploadEncryptedFrame({ buffer, candidateId, index });
		return proxyUrl;
	} catch (err) {
		console.error('[r2FrameStore] Encrypted frame upload failed (fail-closed, no plaintext written):', err.message);
		return null;
	}
}

module.exports = {
	ENVELOPE_VERSION,
	TOKEN_TTL_SEC,
	MAX_FRAME_BYTES,
	uploadEncryptedFrame,
	decryptFrame,
	mintFrameToken,
	verifyFrameToken,
	frameProxyUrl,
	uploadEncryptedFrameForVision,
	// exported for tests
	packEnvelope,
	unpackEnvelope,
};
