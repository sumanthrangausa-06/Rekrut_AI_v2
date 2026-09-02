const crypto = require('node:crypto');

const fs = require('node:fs');
const path = require('node:path');

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM token encryption utilities
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   const { encrypt, decrypt } = require('../lib/crypto-utils');
//   const cipher = encrypt(tokens.access_token);
//   const plain  = decrypt(cipher);
//
// Environment variables:
//   ENCRYPTION_KEY          — Required for production. 32+ char string; SHA-256 hashed to 32 bytes.
//   ENCRYPTION_KEY_PREVIOUS — Optional. Previous key for zero-downtime rotation.
//
// Fallback behavior (dev/test only):
//   If ENCRYPTION_KEY is missing, a cryptographically secure 32-byte key is generated
//   and persisted to .encryption-key-fallback in the project root. A CRITICAL warning
//   is logged on every startup. In production this is a security incident — tokens
//   encrypted with an ephemeral key CANNOT be decrypted if the key file is lost.
//
// Ciphertext format (versioned for future rotation):
//   enc:v1:<base64(iv || authTag || ciphertext)>
//
// Backward compatibility:
//   Strings that do NOT start with "enc:v1:" are returned as-is by decrypt().
//   This allows gradual migration of existing plaintext tokens.
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits (recommended for GCM)
const TAG_LENGTH = 16; // 128 bits (GCM auth tag)
const VERSION_PREFIX = 'enc:v1:';

/**
 * Generate or load a secure fallback encryption key.
 * Persisted to disk so restarts don't invalidate existing ciphertext.
 */
function getFallbackKey() {
	const fallbackPath = path.join(process.cwd(), '.encryption-key-fallback');
	try {
		if (fs.existsSync(fallbackPath)) {
			const stored = fs.readFileSync(fallbackPath, 'utf8').trim();
			if (stored.length >= 32) return stored;
		}
	} catch (_e) {
		// ignore read errors
	}
	const generated = crypto.randomBytes(32).toString('base64');
	try {
		fs.writeFileSync(fallbackPath, generated, { mode: 0o600 });
	} catch (writeErr) {
		console.error(
			'[crypto-utils] CRITICAL: Failed to persist fallback encryption key:',
			writeErr.message,
		);
	}
	return generated;
}

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY env variable.
 * Falls back to a securely generated random key in dev/test environments.
 */
function getPrimaryKey() {
	const keyEnv = process.env.ENCRYPTION_KEY;
	if (keyEnv && keyEnv.length >= 8) {
		return crypto.createHash('sha256').update(keyEnv).digest();
	}

	const nodeEnv = process.env.NODE_ENV || 'development';
	if (nodeEnv === 'production') {
		throw new Error(
			'ENCRYPTION_KEY environment variable is required in production and must be at least 8 characters long',
		);
	}

	const fallback = getFallbackKey();
	console.warn(
		'[crypto-utils] CRITICAL: ENCRYPTION_KEY not set. Using secure fallback key. ' +
			'Tokens encrypted with this key CANNOT be recovered if the key file is lost. ' +
			'Set ENCRYPTION_KEY before deploying to production.',
	);
	return crypto.createHash('sha256').update(fallback).digest();
}

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY_PREVIOUS env variable (optional).
 */
function getPreviousKey() {
	const keyEnv = process.env.ENCRYPTION_KEY_PREVIOUS;
	if (!keyEnv || keyEnv.length < 8) return null;
	return crypto.createHash('sha256').update(keyEnv).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns null for null/undefined input.
 * Returns the plaintext unchanged if it's already encrypted (detected by prefix).
 *
 * @param {string|null|undefined} plaintext
 * @returns {string|null}
 */
function encrypt(plaintext) {
	if (plaintext === null || plaintext === undefined) return null;
	const text = typeof plaintext === 'string' ? plaintext : String(plaintext);

	// Idempotent: don't double-encrypt
	if (text.startsWith(VERSION_PREFIX)) return text;

	const key = getPrimaryKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	let ciphertext = cipher.update(text, 'utf8', 'base64');
	ciphertext += cipher.final('base64');
	const tag = cipher.getAuthTag();

	// iv (16) + tag (16) + ciphertext (variable)
	const payload = Buffer.concat([iv, tag, Buffer.from(ciphertext, 'base64')]);
	return `${VERSION_PREFIX}${payload.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string.
 * If the input does not have our version prefix, returns it as-is (backward compatible).
 *
 * @param {string|null|undefined} ciphertext
 * @returns {string|null}
 * @throws {Error} If decryption fails with both current and previous keys.
 */
function decrypt(ciphertext) {
	if (ciphertext === null || ciphertext === undefined) return null;
	const text = typeof ciphertext === 'string' ? ciphertext : String(ciphertext);

	// Backward compatibility: plaintext tokens stored before this module
	if (!text.startsWith(VERSION_PREFIX)) {
		return text;
	}

	const payload = Buffer.from(text.slice(VERSION_PREFIX.length), 'base64');
	if (payload.length < IV_LENGTH + TAG_LENGTH) {
		throw new Error('Invalid encrypted payload: data too short');
	}

	const iv = payload.subarray(0, IV_LENGTH);
	const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
	const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH);

	const key = getPrimaryKey();

	// Try primary key first
	try {
		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(tag);
		let plaintext = decipher.update(encrypted, undefined, 'utf8');
		plaintext += decipher.final('utf8');
		return plaintext;
	} catch (err) {
		// Try previous key for zero-downtime rotation
		const prevKey = getPreviousKey();
		if (prevKey) {
			try {
				const decipher = crypto.createDecipheriv(ALGORITHM, prevKey, iv);
				decipher.setAuthTag(tag);
				let plaintext = decipher.update(encrypted, undefined, 'utf8');
				plaintext += decipher.final('utf8');
				return plaintext;
			} catch (_e) {
				// Fall through to throw with original error
			}
		}
		throw new Error(`Token decryption failed: ${err.message}`);
	}
}

module.exports = {
	encrypt,
	decrypt,
	// Expose internals for tests / diagnostics
	_ALGORITHM: ALGORITHM,
	_VERSION_PREFIX: VERSION_PREFIX,
};
