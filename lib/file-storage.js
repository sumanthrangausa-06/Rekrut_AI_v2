/**
 * Dual-provider file storage with automatic fallback.
 *
 * Primary: Backblaze B2 (S3-compatible, free tier 10GB)
 * Fallback: Cloudflare R2 (S3-compatible, free tier 10GB)
 *
 * If the primary provider fails, uploads automatically try the fallback.
 * Files are keyed with a provider prefix (b2/... or r2/...) so the serving
 * endpoint knows where to fetch them from.
 *
 * Env vars:
 *   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   (R2 endpoint is derived: https://<account-id>.r2.cloudflarestorage.com)
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

/**
 * Parse STORAGE_KEYS_JSON if present.
 * Format: {"b2": {"keyId": "...", "appKey": "...", "bucket": "...", "endpoint": "..."},
 *          "r2": {"accountId": "...", "accessKey": "...", "secret": "...", "bucket": "..."}}
 * Works around Render free tier's 20 env var limit.
 */
function getStorageJson() {
	if (process.env.STORAGE_KEYS_JSON) {
		try {
			return JSON.parse(process.env.STORAGE_KEYS_JSON);
		} catch (e) {
			console.warn('[file-storage] Failed to parse STORAGE_KEYS_JSON:', e.message);
		}
	}
	return {};
}

// ── Provider configuration ──────────────────────────────────────────

function getProviders() {
	const providers = [];
	const storageJson = getStorageJson();

	// R2 primary: check JSON first, then individual vars
	const r2Json = storageJson.r2 || {};
	const r2AccountId = r2Json.accountId || process.env.R2_ACCOUNT_ID;
	const r2AccessKey = r2Json.accessKey || process.env.R2_ACCESS_KEY_ID;
	const r2Secret = r2Json.secret || process.env.R2_SECRET_ACCESS_KEY;
	const r2Bucket = r2Json.bucket || process.env.R2_BUCKET_NAME;

	if (r2AccountId && r2AccessKey && r2Secret && r2Bucket) {
		providers.push({
			name: 'r2',
			endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
			region: 'auto',
			bucket: r2Bucket,
			keyId: r2AccessKey,
			secret: r2Secret,
		});
	}

	// B2 fallback: check JSON first, then individual vars
	const b2Json = storageJson.b2 || {};
	const b2KeyId = b2Json.keyId || process.env.B2_KEY_ID;
	const b2AppKey = b2Json.appKey || process.env.B2_APPLICATION_KEY;
	const b2Bucket = b2Json.bucket || process.env.B2_BUCKET_NAME;
	const b2Endpoint = b2Json.endpoint || process.env.B2_ENDPOINT;

	if (b2KeyId && b2AppKey && b2Bucket && b2Endpoint) {
		const regionMatch = b2Endpoint.match(/s3\.([^.]+)\.backblazeb2\.com/);
		providers.push({
			name: 'b2',
			endpoint: b2Endpoint,
			region: regionMatch ? regionMatch[1] : 'us-west-004',
			bucket: b2Bucket,
			keyId: b2KeyId,
			secret: b2AppKey,
		});
	}

	return providers;
}

const _clients = new Map();

function getClient(provider) {
	if (_clients.has(provider.name)) return _clients.get(provider.name);

	const client = new S3Client({
		endpoint: provider.endpoint,
		region: provider.region,
		credentials: {
			accessKeyId: provider.keyId,
			secretAccessKey: provider.secret,
		},
		forcePathStyle: true,
	});
	_clients.set(provider.name, client);
	return client;
}

// ── Upload with fallback ────────────────────────────────────────────

/**
 * Upload a file, trying providers in order (B2 first, then R2).
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer
 * @param {string} opts.mimetype
 * @param {string} opts.filename
 * @param {string} [opts.prefix] - Key prefix within provider (default: 'rekrut')
 * @returns {Promise<{url: string, key: string, provider: string}>}
 */
async function uploadFile({ buffer, mimetype, filename, prefix = 'rekrut' }) {
	const providers = getProviders();
	if (providers.length === 0) {
		throw Object.assign(new Error('No storage providers configured'), {
			code: 'STORAGE_NOT_CONFIGURED',
		});
	}

	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
	const objectKey = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

	let lastError = null;
	for (const provider of providers) {
		// Provider-prefixed key so the serving endpoint knows where to fetch from
		const key = `${provider.name}/${objectKey}`;
		try {
			await getClient(provider).send(
				new PutObjectCommand({
					Bucket: provider.bucket,
					Key: objectKey, // B2/R2 key doesn't include our provider prefix
					Body: buffer,
					ContentType: mimetype,
				}),
			);
			if (provider.name !== providers[0].name) {
				console.info(`[file-storage] Upload succeeded via fallback provider: ${provider.name}`);
			}
			return { url: `/api/files/${encodeURIComponent(key)}`, key, provider: provider.name };
		} catch (err) {
			console.warn(`[file-storage] ${provider.name} upload failed:`, err.message);
			lastError = err;
			// Try next provider
		}
	}

	console.error('[file-storage] All providers failed');
	throw Object.assign(
		new Error('File storage service unavailable. Please try again later.'),
		{ code: 'STORAGE_UNAVAILABLE' },
	);
}

// ── Fetch (provider-aware) ──────────────────────────────────────────

/**
 * Fetch a file by its provider-prefixed key (e.g. "b2/resumes/123-abc.pdf").
 */
async function getFile(prefixedKey) {
	const providers = getProviders();
	const slashIdx = prefixedKey.indexOf('/');
	if (slashIdx === -1) {
		throw Object.assign(new Error('Invalid file key'), { code: 'INVALID_KEY', status: 400 });
	}

	const providerName = prefixedKey.slice(0, slashIdx);
	const objectKey = prefixedKey.slice(slashIdx + 1);

	const provider = providers.find(p => p.name === providerName);
	if (!provider) {
		throw Object.assign(new Error('Storage provider not configured'), {
			code: 'STORAGE_NOT_CONFIGURED',
			status: 500,
		});
	}

	try {
		const res = await getClient(provider).send(
			new GetObjectCommand({ Bucket: provider.bucket, Key: objectKey }),
		);
		return {
			stream: res.Body,
			contentType: res.ContentType || 'application/octet-stream',
			contentLength: res.ContentLength,
		};
	} catch (err) {
		if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
			throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND', status: 404 });
		}
		console.error(`[file-storage] Fetch from ${providerName} failed:`, err.message);
		throw Object.assign(new Error('File storage service unavailable'), { code: 'STORAGE_UNAVAILABLE' });
	}
}

// ── Health check ────────────────────────────────────────────────────

/**
 * Check each configured provider. Returns per-provider status.
 */
async function checkStorageHealth() {
	const providers = getProviders();
	if (providers.length === 0) {
		return { ok: false, code: 'NOT_CONFIGURED', message: 'No storage providers configured', providers: [] };
	}

	// Check all providers in parallel so one hanging provider doesn't block others
	const checkOne = async (provider) => {
		try {
			// Probe with a nonexistent key: 404/NoSuchKey means auth worked
			// Use Promise.race for 10s timeout to prevent hanging
			const probe = getClient(provider).send(
				new GetObjectCommand({ Bucket: provider.bucket, Key: `__health_${Date.now()}` }),
			);
			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(Object.assign(new Error('Health check timeout'), { code: 'TIMEOUT' })), 10000)
			);
			await Promise.race([probe, timeout]);
			return { name: provider.name, ok: true, code: 'OK' };
		} catch (err) {
			if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
				return { name: provider.name, ok: true, code: 'OK', message: 'Reachable, credentials valid' };
			} else if (err.$metadata?.httpStatusCode === 401 || err.$metadata?.httpStatusCode === 403) {
				return { name: provider.name, ok: false, code: 'AUTH_FAILED', message: 'Credentials rejected' };
			} else {
				return { name: provider.name, ok: false, code: 'ERROR', message: err.message };
			}
		}
	};

	const results = await Promise.all(providers.map(checkOne));

	const anyOk = results.some(r => r.ok);
	return {
		ok: anyOk,
		code: anyOk ? 'OK' : 'ALL_FAILED',
		message: anyOk ? 'At least one storage provider is healthy' : 'All storage providers failed',
		providers: results,
	};
}

// Backwards-compat aliases (b2-storage.js interface)
const uploadToB2 = uploadFile;
const getFromB2 = getFile;
const checkB2Health = checkStorageHealth;

module.exports = {
	uploadFile,
	uploadToB2, // alias
	getFile,
	getFromB2, // alias
	checkStorageHealth,
	checkB2Health, // alias
	getProviders,
};
