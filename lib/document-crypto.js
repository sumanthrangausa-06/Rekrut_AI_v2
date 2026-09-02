/**
 * Document encryption utilities — AES-256-GCM for file buffers at rest.
 *
 * Usage:
 *   const { encryptBuffer, decryptBuffer, deriveUserKey } = require('../lib/document-crypto');
 *   const { encryptedBuffer, iv, tag } = encryptBuffer(fileBuffer, userId);
 *   const decryptedBuffer = decryptBuffer(encryptedBuffer, iv, tag, userId);
 *
 * Key derivation:
 *   Each user's documents are encrypted with a unique key derived from the global
 *   ENCRYPTION_KEY and the user's ID via HKDF-SHA256. This means:
 *   - Rotating the global key requires re-encrypting all documents
 *   - Compromising one user's key does not expose other users' documents
 *
 * Ciphertext format:
 *   The encrypted file uploaded to R2 is raw AES-256-GCM ciphertext.
 *   IV (16 bytes) and authTag (16 bytes) are stored in the database alongside the record.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = Buffer.from('rekrutai-document-encryption-v1', 'utf8');

/**
 * Get the global master key from ENCRYPTION_KEY.
 */
function getMasterKey() {
	const keyEnv = process.env.ENCRYPTION_KEY;
	if (!keyEnv || keyEnv.length < 8) {
		throw new Error('ENCRYPTION_KEY environment variable is required for document encryption');
	}
	return crypto.createHash('sha256').update(keyEnv).digest();
}

/**
 * Derive a user-specific 32-byte encryption key using HKDF-SHA256.
 *
 * @param {number|string} userId
 * @returns {Buffer} 32-byte key
 */
function deriveUserKey(userId) {
	const masterKey = getMasterKey();
	const info = Buffer.from(`user-${userId}-document-key`, 'utf8');

	// HKDF extract
	const prk = crypto.createHmac('sha256', SALT).update(masterKey).digest();

	// HKDF expand
	const okm = crypto.createHmac('sha256', prk).update(info).digest();

	return okm;
}

/**
 * Encrypt a file buffer with AES-256-GCM using a user-derived key.
 *
 * @param {Buffer} buffer — plaintext file buffer
 * @param {number|string} userId
 * @returns {{encryptedBuffer: Buffer, iv: string, tag: string, algorithm: string}}
 */
function encryptBuffer(buffer, userId) {
	const key = deriveUserKey(userId);
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
	const tag = cipher.getAuthTag();

	// Prepend IV and tag for storage in DB; the encrypted file goes to R2
	return {
		encryptedBuffer: encrypted,
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		algorithm: ALGORITHM,
	};
}

/**
 * Decrypt a file buffer with AES-256-GCM using a user-derived key.
 *
 * @param {Buffer} encryptedBuffer — ciphertext from R2
 * @param {string} iv — base64-encoded IV from DB
 * @param {string} tag — base64-encoded authTag from DB
 * @param {number|string} userId
 * @returns {Buffer} — decrypted plaintext buffer
 */
function decryptBuffer(encryptedBuffer, iv, tag, userId) {
	const key = deriveUserKey(userId);
	const ivBuf = Buffer.from(iv, 'base64');
	const tagBuf = Buffer.from(tag, 'base64');

	const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
	decipher.setAuthTag(tagBuf);

	const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
	return decrypted;
}

module.exports = {
	encryptBuffer,
	decryptBuffer,
	deriveUserKey,
	ALGORITHM,
	IV_LENGTH,
	TAG_LENGTH,
};
