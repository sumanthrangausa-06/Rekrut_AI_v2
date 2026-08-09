const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * AES-256-GCM Encryption Service for Identity Verification
 * 
 * Design principles:
 * - AES-256-GCM: authenticated encryption (confidentiality + integrity)
 * - Key from ENCRYPTION_KEY env var (must be exactly 32 bytes)
 * - Unique IV per encryption operation (96-bit, never reused)
 * - Auth tag appended to ciphertext for integrity verification
 * - Secure random file paths to prevent enumeration attacks
 * - Never store raw images - encrypt before any disk/S3 write
 * 
 * Security notes:
 * - IV reuse with the same key breaks GCM security. We generate fresh IV every time.
 * - Auth tag is 16 bytes, prepended to ciphertext for storage.
 * - The key MUST be exactly 32 bytes. Use: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // Node.js uses 16 bytes for GCM IV (first 12 are actual IV, rest are internal)
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// Lazy-load key so module can be imported before env is fully set
let _cachedKey = null;

function getKey() {
  if (_cachedKey) return _cachedKey;

  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY environment variable is required for identity verification. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be exactly ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars). Got ${key.length} bytes.`);
  }

  _cachedKey = key;
  return key;
}

/**
 * Encrypt a buffer (file contents) using AES-256-GCM
 * @param {Buffer} plaintext - Raw file buffer
 * @returns {Buffer} - Encrypted data: [iv(16)][authTag(16)][ciphertext]
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV + authTag + ciphertext
  // This allows decrypt to extract IV and authTag deterministically
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encrypt()
 * @param {Buffer} ciphertext - Encrypted data: [iv(16)][authTag(16)][ciphertext]
 * @returns {Buffer} - Original plaintext
 */
function decrypt(ciphertext) {
  const key = getKey();

  if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext too short - may be corrupted or tampered');
  }

  const iv = ciphertext.subarray(0, IV_LENGTH);
  const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    throw new Error('Decryption failed - data may be corrupted or tampered');
  }
}

/**
 * Encrypt a file buffer and write to disk under a secure random path
 * @param {Buffer} fileBuffer - Raw file contents
 * @param {string} baseDir - Base directory for storage (default: ./uploads/verification)
 * @param {string} extension - File extension for the encrypted file
 * @returns {string} - Path to encrypted file (relative to baseDir)
 */
function encryptToFile(fileBuffer, baseDir = './uploads/verification', extension = '.enc') {
  // Ensure base directory exists
  const absBaseDir = path.resolve(baseDir);
  if (!fs.existsSync(absBaseDir)) {
    fs.mkdirSync(absBaseDir, { recursive: true, mode: 0o700 }); // owner-only
  }

  // Generate secure random filename (256-bit entropy)
  const randomName = crypto.randomBytes(32).toString('hex');
  const subDir = randomName.substring(0, 2); // shard into subdirs to avoid single-dir overload
  const fileDir = path.join(absBaseDir, subDir);

  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true, mode: 0o700 });
  }

  const encrypted = encrypt(fileBuffer);
  const filePath = path.join(fileDir, `${randomName}${extension}`);
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 }); // owner-read-only

  // Return path relative to baseDir for storage in DB
  return path.join(subDir, `${randomName}${extension}`);
}

/**
 * Read an encrypted file from disk and decrypt it
 * @param {string} relativePath - Path relative to baseDir (stored in DB)
 * @param {string} baseDir - Base directory for storage
 * @returns {Buffer} - Decrypted file contents
 */
function decryptFromFile(relativePath, baseDir = './uploads/verification') {
  const absBaseDir = path.resolve(baseDir);
  const filePath = path.join(absBaseDir, relativePath);

  // Security: ensure the resolved path stays within baseDir
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(absBaseDir)) {
    throw new Error('Invalid file path - path traversal detected');
  }

  const encrypted = fs.readFileSync(resolvedPath);
  return decrypt(encrypted);
}

/**
 * Delete an encrypted file from disk
 * @param {string} relativePath - Path relative to baseDir
 * @param {string} baseDir - Base directory for storage
 */
function deleteEncryptedFile(relativePath, baseDir = './uploads/verification') {
  const absBaseDir = path.resolve(baseDir);
  const filePath = path.join(absBaseDir, relativePath);

  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(absBaseDir)) {
    throw new Error('Invalid file path - path traversal detected');
  }

  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

/**
 * Generate a secure random file path for encrypted storage (without writing)
 * @param {string} baseDir - Base directory
 * @param {string} extension - File extension
 * @returns {string} - Relative path for storage in DB
 */
function generateSecureFilePath(baseDir = './uploads/verification', extension = '.enc') {
  const randomName = crypto.randomBytes(32).toString('hex');
  const subDir = randomName.substring(0, 2);
  return path.join(subDir, `${randomName}${extension}`);
}

/**
 * Hash a file buffer for deduplication / integrity checks
 * Uses SHA-256 (fast, sufficient for integrity, NOT for passwords)
 * @param {Buffer} buffer
 * @returns {string} - Hex-encoded hash
 */
function hashFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  encryptToFile,
  decryptFromFile,
  deleteEncryptedFile,
  generateSecureFilePath,
  hashFile,
  ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  KEY_LENGTH,
};
