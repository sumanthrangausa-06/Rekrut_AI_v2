const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let _cachedKey = null;

function getKey() {
	if (_cachedKey) return _cachedKey;

	const keyHex = process.env.ENCRYPTION_KEY;
	if (!keyHex) {
		throw new Error(
			"ENCRYPTION_KEY environment variable is required. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
		);
	}

	const key = Buffer.from(keyHex, 'hex');
	if (key.length !== KEY_LENGTH) {
		throw new Error(
			`ENCRYPTION_KEY must be exactly ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars). Got ${key.length} bytes.`,
		);
	}

	_cachedKey = key;
	return key;
}

function encrypt(plaintext) {
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(ciphertext) {
	if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error('Ciphertext too short - may be corrupted or tampered');
	}

	const iv = ciphertext.subarray(0, IV_LENGTH);
	const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

	const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
	decipher.setAuthTag(authTag);

	try {
		return Buffer.concat([decipher.update(encrypted), decipher.final()]);
	} catch {
		throw new Error('Decryption failed - data may be corrupted or tampered');
	}
}

function encryptToFile(fileBuffer, baseDir = './uploads/verification', extension = '.enc') {
	const absBaseDir = path.resolve(baseDir);
	fs.mkdirSync(absBaseDir, { recursive: true, mode: 0o700 });

	const randomName = crypto.randomBytes(32).toString('hex');
	const subDir = randomName.substring(0, 2);
	const fileDir = path.join(absBaseDir, subDir);
	fs.mkdirSync(fileDir, { recursive: true, mode: 0o700 });

	const filePath = path.join(fileDir, `${randomName}${extension}`);
	fs.writeFileSync(filePath, encrypt(fileBuffer), { mode: 0o600 });

	return path.join(subDir, `${randomName}${extension}`);
}

function decryptFromFile(relativePath, baseDir = './uploads/verification') {
	const absBaseDir = path.resolve(baseDir);
	const resolvedPath = path.resolve(absBaseDir, relativePath);
	if (!resolvedPath.startsWith(absBaseDir)) {
		throw new Error('Invalid file path - path traversal detected');
	}
	return decrypt(fs.readFileSync(resolvedPath));
}

function deleteEncryptedFile(relativePath, baseDir = './uploads/verification') {
	const absBaseDir = path.resolve(baseDir);
	const resolvedPath = path.resolve(absBaseDir, relativePath);
	if (!resolvedPath.startsWith(absBaseDir)) {
		throw new Error('Invalid file path - path traversal detected');
	}
	if (fs.existsSync(resolvedPath)) {
		fs.unlinkSync(resolvedPath);
	}
}

function generateSecureFilePath(_baseDir = './uploads/verification', extension = '.enc') {
	const randomName = crypto.randomBytes(32).toString('hex');
	return path.join(randomName.substring(0, 2), `${randomName}${extension}`);
}

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
