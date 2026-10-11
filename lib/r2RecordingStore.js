/**
 * r2RecordingStore — Encrypted R2 recording storage with per-candidate DEKs (S-069 #722).
 *
 * Problem (privacy H-4, S-059 review): full `.webm` interview recordings were
 * uploaded to R2/B2 with no encryption, bypassing the crypto-shredding design.
 * This module is the single choke point for recording uploads: every recording
 * is encrypted with the candidate's DEK (via lib/biometricCrypto.js) BEFORE
 * the storage PUT. There is no plaintext path.
 *
 * Design (mirrors S-059's r2FrameStore envelope pattern):
 *  - Envelope (self-describing, versioned): 0x01 || iv(12) || tag(16) || ciphertext
 *    AES-256-GCM via biometricCrypto. AAD binds the candidate AND the data
 *    type: `r2recording:v1:candidate:<candidateId>` — a SEPARATE namespace from
 *    frames (`r2frame:...`), so a frame envelope can never be replayed as a
 *    recording (cross-type substitution is cryptographically impossible), and
 *    the DEK is per-candidate regardless.
 *  - Stored mimetype is application/octet-stream (ciphertext, not a WebM);
 *    stored keys carry a `.enc` suffix so ciphertext is trivially
 *    distinguishable from legacy plaintext `.webm` objects.
 *  - Buffer-based: multer already holds the upload in memory (50MB limit);
 *    recordings stream through the same envelope as frames, no chunked
 *    crypto needed.
 *  - Playback is via the session-auth decrypt-proxy route in
 *    routes/interviews.js (GET /video-playback/:interviewId/:questionIndex) —
 *    NOT capability tokens: unlike vision APIs, playback consumers present a
 *    session. The proxy verifies interview ownership, fetches the envelope,
 *    decrypts with the candidate's DEK, and streams video/webm with
 *    Cache-Control: no-store.
 *  - DEK destruction (crypto-shredding) renders every stored recording
 *    unrecoverable: decryptRecording throws and the proxy returns 403 (AC-3).
 *  - Fail-closed: missing candidateId or any crypto/storage failure throws —
 *    plaintext is NEVER uploaded.
 */

const crypto = require('node:crypto');
const { uploadToB2, getFile } = require('./file-storage');
const { encryptWithDEK, decryptWithExistingDEK } = require('./biometricCrypto');
const { packEnvelope, unpackEnvelope } = require('./r2FrameStore');

const RECORDING_AAD_PREFIX = 'r2recording:v1:candidate:';
// Multer holds uploads in memory (50MB plaintext limit in routes/interviews.js).
// The decrypt cap covers the envelope (plaintext + 29 bytes overhead) plus slack.
const MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024;
const MAX_RECORDING_BYTES = MAX_PLAINTEXT_BYTES + 1024;
// Pentest discipline (S-059 LOW-1): the decryptor may only reference recording
// objects under the interviews/ prefix, never other prefixes.
const RECORDING_KEY_RE = /^(b2|r2)\/interviews\//;

function _codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/**
 * AAD binds ciphertext to the candidate, the interview, AND the question.
 * Separate namespace from frames — cross-type replay is impossible.
 * Interview/question binding (crypto H1) prevents same-candidate answer
 * replay: a Q0 envelope cannot authenticate as Q1 even with the same DEK.
 */
function recordingAAD(candidateId, interviewId, questionIndex) {
	return `${RECORDING_AAD_PREFIX}${candidateId}:interview:${interviewId}:q:${questionIndex}`;
}

async function streamToBuffer(stream) {
	const chunks = [];
	let total = 0;
	for await (const chunk of stream) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > MAX_RECORDING_BYTES) {
			throw _codedError(
				'RECORDING_TOO_LARGE',
				`r2RecordingStore: recording exceeds ${MAX_RECORDING_BYTES} bytes`,
			);
		}
		chunks.push(buf);
	}
	return Buffer.concat(chunks);
}

/**
 * Encrypt a recording buffer and upload the ciphertext envelope.
 * FAIL-CLOSED: throws on missing candidateId or any crypto/storage failure.
 * Plaintext is never uploaded.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer raw recording bytes (e.g. WebM)
 * @param {number|string} opts.candidateId owner of the DEK
 * @param {number|string} opts.interviewId interview id (for filename only)
 * @param {number} opts.questionIndex question index (for filename only)
 * @returns {Promise<{key: string}>} provider-prefixed storage key of the envelope
 */
async function uploadEncryptedRecording({ buffer, candidateId, interviewId, questionIndex }) {
	if (candidateId == null) {
		throw _codedError(
			'CANDIDATE_REQUIRED',
			'r2RecordingStore: candidateId is required (fail-closed)',
		);
	}
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		throw _codedError('INVALID_RECORDING', 'r2RecordingStore: buffer must be a non-empty Buffer');
	}
	// Crypto L2: defense-in-depth size cap for future callers (multer already
	// enforces 50MB at the current call site).
	if (buffer.length > MAX_PLAINTEXT_BYTES) {
		throw _codedError(
			'RECORDING_TOO_LARGE',
			`r2RecordingStore: plaintext exceeds ${MAX_PLAINTEXT_BYTES} bytes`,
		);
	}
	if (interviewId == null || questionIndex == null) {
		throw _codedError(
			'INVALID_RECORDING',
			'r2RecordingStore: interviewId and questionIndex are required for AAD binding',
		);
	}
	// Encrypt FIRST — the storage PUT only ever sees ciphertext (AC-1).
	const { ciphertext, iv, tag } = await encryptWithDEK(
		buffer,
		candidateId,
		recordingAAD(candidateId, interviewId, questionIndex),
	);
	const envelope = packEnvelope({ iv, tag, ciphertext });

	const result = await uploadToB2({
		buffer: envelope,
		mimetype: 'application/octet-stream', // ciphertext, not a WebM
		// Privacy M-1: opaque random names — no interview ID, question index,
		// or content-type hints in the key (cf. S-059 frame naming). The
		// interview/question mapping lives only in the DB row. The .enc
		// suffix distinguishes ciphertext from legacy plaintext .webm objects.
		filename: `recording-${crypto.randomBytes(8).toString('hex')}.enc`,
		prefix: 'interviews',
	});
	return { key: result.key };
}

/**
 * Fetch a stored recording envelope and decrypt it.
 * Throws when the DEK was destroyed (crypto-shredding, AC-3), the envelope
 * is malformed/tampered, the key is outside the interviews/ prefix, or the
 * candidate does not own the DEK.
 *
 * @param {string} objectKey provider-prefixed storage key
 * @param {number|string} candidateId
 * @param {number|string} interviewId must match the AAD bound at upload
 * @param {number} questionIndex must match the AAD bound at upload
 * @returns {Promise<Buffer>} plaintext recording bytes
 */
async function decryptRecording(objectKey, candidateId, interviewId, questionIndex) {
	if (candidateId == null) {
		throw _codedError(
			'CANDIDATE_REQUIRED',
			'r2RecordingStore: candidateId is required (fail-closed)',
		);
	}
	if (!objectKey || typeof objectKey !== 'string' || !RECORDING_KEY_RE.test(objectKey)) {
		throw _codedError(
			'RECORDING_KEY_INVALID',
			'r2RecordingStore: object key is not a recording object',
		);
	}
	if (interviewId == null || questionIndex == null) {
		throw _codedError(
			'INVALID_RECORDING',
			'r2RecordingStore: interviewId and questionIndex are required for AAD binding',
		);
	}
	const { stream } = await getFile(objectKey);
	const envelope = await streamToBuffer(stream);
	const { iv, tag, ciphertext } = unpackEnvelope(envelope);
	// Crypto L1 (S-059): select-only DEK read — a decrypt must never create key material.
	return decryptWithExistingDEK(
		ciphertext,
		iv,
		tag,
		candidateId,
		recordingAAD(candidateId, interviewId, questionIndex),
	);
}

module.exports = {
	RECORDING_AAD_PREFIX,
	MAX_PLAINTEXT_BYTES,
	MAX_RECORDING_BYTES,
	recordingAAD,
	uploadEncryptedRecording,
	decryptRecording,
};
