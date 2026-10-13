/**
 * r2ObserverAudioStore — encrypted storage for Gate A observer audio
 * chunks (S-085 #787, design §4.2). The single choke point for observer
 * audio PUTs: every chunk is encrypted under the candidate's DEK (via
 * lib/biometricCrypto.js) BEFORE the storage PUT. There is no plaintext
 * path, and this module exports NO decrypt function — decryption exists
 * only in lib/observerAudioTestDecrypt.js (test prefix, non-production),
 * so captured audio is write-only in production code (design §4.2, P-21).
 *
 * Keys: generated BEFORE the PUT (registry-intent-first, §4.4) —
 *   observer-audio/audio-<16 hex>.enc        (activation scope)
 *   observer-audio-test/audio-<16 hex>.enc   (test scope)
 * Opaque random; no candidate ID, session ID, or timestamp in the key.
 * The DB registry row is the only place a key is associated with a
 * candidate/session.
 *
 * Envelope: biometricCrypto AES-256-GCM via r2FrameStore.packEnvelope
 * (0x01 || iv(12) || tag(16) || ciphertext). Chunk AAD binds candidate +
 * session + chunk index in its own namespace — a chunk envelope cannot
 * be replayed as a frame, a recording, a measurement, or another chunk.
 */
const crypto = require('node:crypto');
const { uploadToB2, deleteStorageObject } = require('./file-storage');
const { encryptWithDEK } = require('./biometricCrypto');
const { packEnvelope } = require('./r2FrameStore');

const CHUNK_AAD_PREFIX = 'r2observeraudio:v1:candidate:';
const PREFIX_BY_SCOPE = { activation: 'observer-audio', test: 'observer-audio-test' };
const OBSERVER_AUDIO_KEY_RE = /^(b2|r2)\/observer-audio(-test)?\//;

function _codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

function _assertIntegerIds(ids) {
	// AAD injectivity relies on colon-free components (security review
	// minor 6): every id interpolated into an AAD must be an integer.
	for (const v of ids) {
		if (!Number.isInteger(v)) {
			throw _codedError('INVALID_ID', 'r2ObserverAudioStore: AAD components must be integers');
		}
	}
}

/** AAD for one audio chunk: binds candidate, session, and chunk index. */
function chunkAAD(candidateId, sessionId, chunkIndex) {
	_assertIntegerIds([candidateId, sessionId, chunkIndex]);
	return `${CHUNK_AAD_PREFIX}${candidateId}:session:${sessionId}:chunk:${chunkIndex}`;
}

/** AAD for the per-session speech-measurements envelope (design §4.3). */
function measurementAAD(candidateId, sessionId) {
	_assertIntegerIds([candidateId, sessionId]);
	return `observermeasurements:v1:candidate:${candidateId}:session:${sessionId}`;
}

/** Generate the opaque object key for a chunk in the given scope. */
function generateChunkKey(scope) {
	const prefix = PREFIX_BY_SCOPE[scope];
	if (!prefix) {
		throw _codedError('INVALID_SCOPE', `r2ObserverAudioStore: unknown scope "${scope}"`);
	}
	return `${prefix}/audio-${crypto.randomBytes(8).toString('hex')}.enc`;
}

/**
 * Encrypt + PUT a chunk at a caller-generated bare key. This is the
 * ONLY write entry point (security review minor 3): the one-call
 * convenience wrapper that PUT without a registry intent was removed,
 * so an unregistered object is impossible at this module's API level,
 * not merely by caller discipline. The caller writes the intent row
 * under `bareKey` in a committed transaction BEFORE calling this
 * (design §4.4), then confirms under the returned provider-prefixed key.
 * FAIL-CLOSED: throws on missing ids, empty buffer, malformed key, or
 * any crypto/storage failure. Plaintext is never uploaded.
 */
async function putEncryptedChunkAtKey({ pcmBuffer, candidateId, sessionId, chunkIndex, bareKey }) {
	if (candidateId == null) {
		throw _codedError('CANDIDATE_REQUIRED', 'r2ObserverAudioStore: candidateId is required (fail-closed)');
	}
	if (sessionId == null || chunkIndex == null) {
		throw _codedError('INVALID_CHUNK', 'r2ObserverAudioStore: sessionId and chunkIndex are required for AAD binding');
	}
	if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
		throw _codedError('INVALID_CHUNK', 'r2ObserverAudioStore: pcmBuffer must be a non-empty Buffer');
	}
	if (typeof bareKey !== 'string' || !/^(observer-audio|observer-audio-test)\/audio-[0-9a-f]{16}\.enc$/.test(bareKey)) {
		throw _codedError('INVALID_KEY', 'r2ObserverAudioStore: bareKey is not an observer-audio key');
	}
	// Encrypt FIRST — the storage PUT only ever sees ciphertext.
	const { ciphertext, iv, tag } = await encryptWithDEK(
		pcmBuffer,
		candidateId,
		chunkAAD(candidateId, sessionId, chunkIndex),
	);
	const envelope = packEnvelope({ iv, tag, ciphertext });
	const result = await uploadToB2({
		buffer: envelope,
		mimetype: 'application/octet-stream', // ciphertext, not audio
		filename: bareKey.slice(bareKey.lastIndexOf('/') + 1),
		objectKey: bareKey, // intent-first: the key is known before the PUT
	});
	return { key: result.key, byteSize: envelope.length };
}

/**
 * Delete one observer-audio object by provider-prefixed key.
 * Idempotent (NoSuchKey = success) via file-storage. Rejects keys outside
 * the observer prefixes — this helper must never become a generic delete.
 */
async function deleteObserverAudioObject(objectKey) {
	if (typeof objectKey !== 'string' || !OBSERVER_AUDIO_KEY_RE.test(objectKey)) {
		throw _codedError('INVALID_KEY', 'r2ObserverAudioStore: key is not an observer-audio object');
	}
	return deleteStorageObject(objectKey);
}

module.exports = {
	CHUNK_AAD_PREFIX,
	PREFIX_BY_SCOPE,
	OBSERVER_AUDIO_KEY_RE,
	chunkAAD,
	measurementAAD,
	generateChunkKey,
	putEncryptedChunkAtKey,
	deleteObserverAudioObject,
	// NOTE: no decrypt export — see lib/observerAudioTestDecrypt.js (P-21).
};
