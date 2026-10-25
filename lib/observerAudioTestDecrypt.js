/**
 * observerAudioTestDecrypt — the ONLY decrypt path for observer audio
 * (Gate A, S-085 #787, design §4.2, privacy condition P-21).
 *
 * Isolation rules, all enforced at runtime AND by build-evidence grep:
 *   - Imported ONLY by tests and validation tooling. No production module
 *     may import this file (the C-5 suite greps for importers).
 *   - Refuses to run when the process env identity is 'production'.
 *   - Refuses any key outside the observer-audio-test/ prefix — activation
 *     audio has no decrypt path anywhere in the codebase by design.
 *   - Uses decryptWithExistingDEK (select-only): a decrypt NEVER creates
 *     key material (S-059 crypto L1). After erasure (DEK destroyed) this
 *     throws, which is exactly what test T8b asserts.
 */
const { getFile } = require('./file-storage');
const { decryptWithExistingDEK } = require('./biometricCrypto');
const { unpackEnvelope } = require('./r2FrameStore');
const { chunkAAD } = require('./r2ObserverAudioStore');
const { resolveEnvIdentity } = require('./observerEnvIdentity');

const TEST_KEY_RE = /^(b2|r2)\/observer-audio-test\//;

function _codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

async function streamToBuffer(stream) {
	const chunks = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/**
 * Decrypt one TEST-scope chunk for validation. Throws in production,
 * throws for non-test keys, throws when the DEK is gone.
 * @returns {Promise<Buffer>} plaintext PCM
 */
// Decryption is permitted ONLY under an explicitly recognised
// non-production identity (security review M-2 / privacy A-10): the old
// check refused 'production' but failed OPEN on 'unknown' — an
// unidentifiable host must never decrypt.
const DECRYPT_PERMITTED_IDENTITIES = ['staging', 'development', 'test'];
const MAX_TEST_OBJECT_BYTES = 10 * 1024 * 1024; // mirrors r2FrameStore's cap

async function decryptTestChunk(objectKey, candidateId, sessionId, chunkIndex) {
	if (!DECRYPT_PERMITTED_IDENTITIES.includes(resolveEnvIdentity())) {
		throw _codedError('TEST_DECRYPT_FORBIDDEN', 'observerAudioTestDecrypt: env identity does not permit test decryption');
	}
	if (typeof objectKey !== 'string' || !TEST_KEY_RE.test(objectKey)) {
		throw _codedError('TEST_DECRYPT_FORBIDDEN', 'observerAudioTestDecrypt: only observer-audio-test/ keys may be decrypted');
	}
	if (candidateId == null || sessionId == null || chunkIndex == null) {
		throw _codedError('INVALID_CHUNK', 'observerAudioTestDecrypt: candidateId, sessionId, chunkIndex are required');
	}
	const { stream } = await getFile(objectKey);
	const envelope = await streamToBuffer(stream);
	if (envelope.length > MAX_TEST_OBJECT_BYTES) {
		throw _codedError('OBJECT_TOO_LARGE', 'observerAudioTestDecrypt: test object exceeds the size bound');
	}
	const { iv, tag, ciphertext } = unpackEnvelope(envelope);
	return decryptWithExistingDEK(ciphertext, iv, tag, candidateId, chunkAAD(candidateId, sessionId, chunkIndex));
}

module.exports = { decryptTestChunk, TEST_KEY_RE };
