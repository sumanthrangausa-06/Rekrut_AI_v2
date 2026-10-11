/**
 * Frame decrypt-proxy — S-059 (#630).
 *
 * GET /api/frames/:token
 *
 * Vision APIs (Polsia proxy → GPT-4o) need HTTP URLs for frames, but R2 now
 * holds only ciphertext. This endpoint is the SOLE decryptor: it verifies
 * the HMAC-signed capability token, fetches the envelope from R2, decrypts
 * with the candidate's DEK, and streams plaintext JPEG bytes.
 *
 * AUTH MODEL (AC-2): no session cookie / bearer token is accepted here. The
 * token itself is the authorization — minted server-side inside an
 * authenticated upload request, HMAC-signed with a server-derived key,
 * bound to exactly one frame key + one candidate, 10-minute TTL. Forged,
 * tampered, or expired tokens → 403. This is strictly stronger than the
 * previous R2 presigned URLs (1-hour TTL, no candidate binding).
 *
 * Mount WITHOUT auth middleware: external vision APIs cannot present a
 * session. Mount in server.js as: app.use('/api', frameProxyRoutes)
 */

const express = require('express');
const { rateLimits } = require('../../lib/distributed-rate-limiter');
const { verifyFrameToken, decryptFrame } = require('../../lib/r2FrameStore');

const router = express.Router();

// Crypto L4 / pentest M-2 / privacy M-2: the proxy is unauthenticated by design
// (token is the capability), so rate-limit it. Each hit costs R2 GET + decrypt.
router.use('/frames', rateLimits.public);

function tokenErrorStatus(err) {
	switch (err && err.code) {
		case 'FRAME_TOKEN_INVALID':
		case 'FRAME_TOKEN_EXPIRED':
			return 403;
		default:
			return null;
	}
}

router.get('/frames/:token', async (req, res) => {
	let key;
	let candidateId;
	try {
		({ key, candidateId } = verifyFrameToken(req.params.token));
	} catch (err) {
		const status = tokenErrorStatus(err) || 403;
		return res.status(status).json({ error: 'Frame access denied', code: err.code || 'FRAME_TOKEN_INVALID' });
	}

	try {
		const jpeg = await decryptFrame(key, candidateId);
		res.set('Content-Type', 'image/jpeg');
		res.set('Content-Length', String(jpeg.length));
		// Never cache plaintext biometric frames at the edge
		res.set('Cache-Control', 'no-store');
		return res.send(jpeg);
	} catch (err) {
		if (err.code === 'NOT_FOUND') {
			return res.status(404).json({ error: 'Frame not found', code: 'NOT_FOUND' });
		}
		// Decryption failure (wrong DEK, tampered bytes, destroyed DEK) and
		// storage outages all present as 403/503 WITHOUT distinguishing —
		// no oracle for attackers probing key validity.
		if (err.code === 'STORAGE_UNAVAILABLE') {
			return res.status(503).json({ error: 'Frame temporarily unavailable', code: 'STORAGE_UNAVAILABLE' });
		}
		if (err.code === 'FRAME_TOO_LARGE') {
			return res.status(413).json({ error: 'Frame too large', code: 'FRAME_TOO_LARGE' });
		}
		return res.status(403).json({ error: 'Frame access denied', code: 'FRAME_DECRYPT_FAILED' });
	}
});

module.exports = router;
