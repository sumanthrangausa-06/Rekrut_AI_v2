/**
 * biometricCrypto — Per-candidate encryption for segregated biometric data.
 *
 * S-058 (#582): Implements ADR-012 crypto-shredding.
 *
 * Design:
 *   - Each candidate gets a RANDOM 256-bit DEK (data encryption key), stored
 *     in `candidate_data_keys` encrypted under the BIOMETRIC_ENCRYPTION_KEY
 *     master key (AES-256-GCM).
 *   - Biometric templates are encrypted under the candidate's DEK.
 *   - DSAR deletion = destroyDEK() → DEK row zeroed → all ciphertext under it
 *     becomes unrecoverable from the live database.
 *
 * Why random DEKs, not HKDF (replaces document-crypto.js pattern):
 *   HKDF-derived keys are re-derivable from the master key + candidate ID.
 *   "Deleting" a derived key is meaningless — it can be recomputed. Random
 *   DEKs are the only keys that can be truly destroyed (ADR-012).
 *
 * Honest scope of crypto-shredding (per specialist review 2026-10-10):
 *   destroyDEK() makes data unrecoverable from the LIVE database. Database
 *   backups taken before destruction retain the wrapped DEK, decryptable
 *   with the still-live master key. Complete backup-proof deletion requires
 *   master-key rotation on DSAR delete (documented follow-up for S-015/S-057;
 *   ADR-012 to be amended). Do not represent deletion as backup-proof until
 *   rotation is implemented.
 *
 * Fail-secure: throws when BIOMETRIC_ENCRYPTION_KEY is missing or malformed.
 * Expected format: 32-byte key as 64-char hex or 44-char base64.
 *
 * Memory hygiene: DEK and plaintext buffers are zeroed after use (best-effort;
 * JS GC may retain copies — documented residual risk).
 */
const crypto = require('node:crypto');
const db = require('./db');
const biometricAudit = require('./biometricAudit');

const ALGORITHM = 'aes-256-gcm';
const DEK_LENGTH = 32; // 256-bit
const IV_LENGTH = 12; // GCM standard nonce size
const TAG_LENGTH = 16;
const WRAP_VERSION = 0x01;
const WRAPPED_DEK_LENGTH = 1 + IV_LENGTH + TAG_LENGTH + DEK_LENGTH; // 61

/**
 * Get the master key from BIOMETRIC_ENCRYPTION_KEY.
 * Fail-secure: throws when missing or not a 32-byte key in hex/base64.
 */
function getMasterKey() {
	const keyEnv = process.env.BIOMETRIC_ENCRYPTION_KEY;
	if (!keyEnv) {
		throw new Error(
			'BIOMETRIC_ENCRYPTION_KEY environment variable is required (32-byte key as 64-char hex or 44-char base64)',
		);
	}
	let key;
	if (/^[0-9a-fA-F]{64}$/.test(keyEnv)) {
		key = Buffer.from(keyEnv, 'hex');
	} else {
		try {
			key = Buffer.from(keyEnv, 'base64');
		} catch {
			key = null;
		}
	}
	if (!key || key.length !== 32) {
		throw new Error(
			'BIOMETRIC_ENCRYPTION_KEY must be a 32-byte key encoded as 64-char hex or 44-char base64',
		);
	}
	return key;
}

/**
 * Generate a fresh random 256-bit DEK.
 * @returns {Buffer} 32 random bytes
 */
function generateDEK() {
	return crypto.randomBytes(DEK_LENGTH);
}

/**
 * Generate a fresh random 256-bit subject reference (opaque biometric subject token).
 * @returns {Buffer} 32 random bytes
 */
function generateSubjectRef() {
	return crypto.randomBytes(32);
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * @param {Buffer} plaintext
 * @param {Buffer} key 32-byte key
 * @param {Buffer|string} [aad] additional authenticated data (binds ciphertext to context)
 * @returns {{ciphertext: Buffer, iv: Buffer, tag: Buffer}}
 */
function encryptBuffer(plaintext, key, aad) {
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	if (aad != null) {
		cipher.setAAD(Buffer.isBuffer(aad) ? aad : Buffer.from(String(aad), 'utf8'));
	}
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return { ciphertext, iv, tag };
}

/**
 * Decrypt a buffer with AES-256-GCM. Throws on authentication failure.
 * @param {Buffer|string} [aad] must match the AAD used at encryption
 */
function decryptBuffer(ciphertext, iv, tag, key, aad) {
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
	if (aad != null) {
		decipher.setAAD(Buffer.isBuffer(aad) ? aad : Buffer.from(String(aad), 'utf8'));
	}
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * AAD context for DEK wrapping — binds a wrapped DEK to its candidate.
 */
function dekWrapAAD(candidateId) {
	return `candidate_data_keys:v1:candidate:${candidateId}`;
}

/**
 * Wrap (encrypt) a DEK under the master key for storage.
 * Format: version (1) || iv (12) || tag (16) || ciphertext (32).
 * The DEK is bound to candidateId via AAD — a wrapped DEK cannot be
 * transplanted to another candidate's row.
 */
function wrapDEK(dek, candidateId) {
	const masterKey = getMasterKey();
	try {
		const { ciphertext, iv, tag } = encryptBuffer(dek, masterKey, dekWrapAAD(candidateId));
		return Buffer.concat([Buffer.from([WRAP_VERSION]), iv, tag, ciphertext]);
	} finally {
		masterKey.fill(0);
	}
}

/**
 * Unwrap (decrypt) a stored DEK using the master key.
 * Verifies version byte and AAD binding to candidateId.
 */
function unwrapDEK(wrapped, candidateId) {
	if (!Buffer.isBuffer(wrapped) || wrapped.length !== WRAPPED_DEK_LENGTH) {
		throw new Error(
			'biometricCrypto.unwrapDEK: malformed wrapped DEK (expected 61 bytes)',
		);
	}
	if (wrapped[0] !== WRAP_VERSION) {
		throw new Error(
			`biometricCrypto.unwrapDEK: unsupported key version 0x${wrapped[0].toString(16)} (expected 0x01)`,
		);
	}
	const masterKey = getMasterKey();
	try {
		const iv = wrapped.subarray(1, 1 + IV_LENGTH);
		const tag = wrapped.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
		const ciphertext = wrapped.subarray(1 + IV_LENGTH + TAG_LENGTH);
		return decryptBuffer(ciphertext, iv, tag, masterKey, dekWrapAAD(candidateId));
	} finally {
		masterKey.fill(0);
	}
}

/**
 * Get the candidate's DEK, creating and storing a new random one if needed.
 * Atomic: INSERT ... ON CONFLICT DO NOTHING + re-SELECT (no TOCTOU race).
 * Throws if the DEK was destroyed (crypto-shredded).
 *
 * @param {number} candidateId
 * @returns {Promise<Buffer>} 32-byte DEK
 */
async function getOrCreateDEK(candidateId) {
	if (candidateId == null) {
		throw new Error('biometricCrypto.getOrCreateDEK: candidateId is required');
	}
	const dek = generateDEK();
	const wrapped = wrapDEK(dek, candidateId);
	// Atomic upsert: concurrent callers converge on a single row.
	await db.query(
		`INSERT INTO candidate_data_keys (candidate_id, dek_encrypted)
       VALUES ($1, $2)
       ON CONFLICT (candidate_id) DO NOTHING`,
		[candidateId, wrapped],
	);
	dek.fill(0); // the inserted copy may not be the winner; zero our buffer
	const { rows } = await db.query(
		'SELECT dek_encrypted, destroyed_at FROM candidate_data_keys WHERE candidate_id = $1',
		[candidateId],
	);
	if (rows.length === 0) {
		throw new Error(
			`biometricCrypto.getOrCreateDEK: no DEK row for candidate ${candidateId} after upsert`,
		);
	}
	if (rows[0].destroyed_at != null) {
		throw new Error(
			`biometricCrypto.getOrCreateDEK: DEK for candidate ${candidateId} was destroyed (crypto-shredded)`,
		);
	}
	return unwrapDEK(rows[0].dek_encrypted, candidateId);
}

/**
 * Encrypt a buffer under the candidate's DEK.
 * @param {Buffer|string} [aad] binds ciphertext to context (e.g. subject_ref)
 * @returns {Promise<{ciphertext: Buffer, iv: Buffer, tag: Buffer}>}
 */
async function encryptWithDEK(plaintext, candidateId, aad) {
	const dek = await getOrCreateDEK(candidateId);
	try {
		return encryptBuffer(plaintext, dek, aad);
	} finally {
		dek.fill(0);
	}
}

/**
 * Decrypt a buffer under the candidate's DEK.
 * @param {Buffer|string} [aad] must match the AAD used at encryption
 * @returns {Promise<Buffer>}
 */
async function decryptWithDEK(ciphertext, iv, tag, candidateId, aad) {
	const dek = await getOrCreateDEK(candidateId);
	try {
		return decryptBuffer(ciphertext, iv, tag, dek, aad);
	} finally {
		dek.fill(0);
	}
}

/**
 * Get the candidate's DEK WITHOUT creating one (read path).
 * S-059 (#630) crypto review L1: the decrypt path must not INSERT key
 * material — a read that creates a DEK row litters candidate_data_keys and
 * muddies the crypto-shredding audit trail.
 * @throws when no DEK row exists or the DEK was destroyed
 * @returns {Promise<Buffer>} 32-byte DEK (caller must zero after use)
 */
async function getDEK(candidateId) {
	if (candidateId == null) {
		throw new Error('biometricCrypto.getDEK: candidateId is required');
	}
	const { rows } = await db.query(
		'SELECT dek_encrypted, destroyed_at FROM candidate_data_keys WHERE candidate_id = $1',
		[candidateId],
	);
	if (rows.length === 0) {
		throw new Error(`biometricCrypto.getDEK: no DEK row for candidate ${candidateId}`);
	}
	if (rows[0].destroyed_at != null) {
		throw new Error(
			`biometricCrypto.getDEK: DEK for candidate ${candidateId} was destroyed (crypto-shredded)`,
		);
	}
	return unwrapDEK(rows[0].dek_encrypted, candidateId);
}

/**
 * Decrypt a buffer under the candidate's EXISTING DEK (no creation).
 * Use on read paths (e.g. the S-059 frame decrypt-proxy).
 * @param {Buffer|string} [aad] must match the AAD used at encryption
 * @returns {Promise<Buffer>}
 */
async function decryptWithExistingDEK(ciphertext, iv, tag, candidateId, aad) {
	const dek = await getDEK(candidateId);
	try {
		return decryptBuffer(ciphertext, iv, tag, dek, aad);
	} finally {
		dek.fill(0);
	}
}

/**
 * Crypto-shred a candidate's DEK: zero the stored key and mark destroyed.
 * All data encrypted under this DEK becomes unrecoverable from the live DB.
 * Throws DEKNotFound when no row exists (deletion must be verifiable).
 *
 * S-067 (#720): accepts an optional `options` bag:
 *   - options.client — pg client/pool used for the UPDATE (transaction support).
 *     Defaults to the shared pool.
 *   - options.audit — { userId, userRole, ipAddress }. When provided, writes a
 *     biometric_audit_log 'purge' entry on the SAME client (atomic with the
 *     destruction; AC-3).
 */
async function destroyDEK(candidateId, options = {}) {
	if (candidateId == null) {
		throw new Error('biometricCrypto.destroyDEK: candidateId is required');
	}
	// Privacy H-3 (S-069 review): the old `'\\x'` literal is invalid bytea
	// syntax in Postgres (hex escape with no digits). Use a parameterized
	// empty Buffer — the driver encodes it correctly.
	const { client = db, audit } = options || {};
	const { rowCount } = await client.query(
		`UPDATE candidate_data_keys
       SET destroyed_at = NOW(), dek_encrypted = $2
       WHERE candidate_id = $1`,
		[candidateId, Buffer.alloc(0)],
	);
	if (rowCount === 0) {
		const err = new Error(
			`biometricCrypto.destroyDEK: no DEK row for candidate ${candidateId} (DEKNotFound)`,
		);
		err.code = 'DEKNotFound';
		throw err;
	}
	// S-067 (#720) AC-3: every destruction writes an audit entry, on the same
	// client so it rolls back with the transaction on failure.
	if (audit) {
		await biometricAudit.logAccess(
			{
				userId: audit.userId,
				userRole: audit.userRole,
				action: 'purge',
				dataType: 'dek',
				candidateId,
				ipAddress: audit.ipAddress,
			},
			client,
		);
	}
}

/**
 * Check whether a candidate's DEK has been destroyed.
 */
async function isDEKDestroyed(candidateId) {
	const { rows } = await db.query(
		'SELECT destroyed_at FROM candidate_data_keys WHERE candidate_id = $1',
		[candidateId],
	);
	return rows.length > 0 && rows[0].destroyed_at != null;
}

module.exports = {
	generateDEK,
	generateSubjectRef,
	getMasterKey,
	encryptBuffer,
	decryptBuffer,
	wrapDEK,
	unwrapDEK,
	dekWrapAAD,
	getOrCreateDEK,
	getDEK,
	encryptWithDEK,
	decryptWithDEK,
	decryptWithExistingDEK,
	destroyDEK,
	isDEKDestroyed,
};
