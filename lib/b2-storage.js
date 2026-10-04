/**
 * Backblaze B2 file storage (S3-compatible API).
 *
 * Replaces the Polsia R2 proxy (which had a dead API key and no way to get a
 * new one). B2's free tier (10GB) covers pre-launch needs at $0.
 *
 * Env vars required:
 *   B2_KEY_ID         — Application key ID (the "username")
 *   B2_APPLICATION_KEY — Application key (the "secret")
 *   B2_BUCKET_NAME    — Bucket name
 *   B2_ENDPOINT       — S3 endpoint, e.g. https://s3.us-west-004.backblazeb2.com
 *
 * Files are stored under a `rekrut/` prefix and served via GET /api/files/:key.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

let _client = null;

function getClient() {
	if (_client) return _client;

	const keyId = process.env.B2_KEY_ID;
	const appKey = process.env.B2_APPLICATION_KEY;
	const endpoint = process.env.B2_ENDPOINT;

	if (!keyId || !appKey || !endpoint) {
		throw Object.assign(new Error('B2 storage not configured'), { code: 'STORAGE_NOT_CONFIGURED' });
	}

	// Extract region from endpoint: https://s3.us-west-004.backblazeb2.com → us-west-004
	const regionMatch = endpoint.match(/s3\.([^.]+)\.backblazeb2\.com/);
	const region = regionMatch ? regionMatch[1] : 'us-west-004';

	_client = new S3Client({
		endpoint,
		region,
		credentials: {
			accessKeyId: keyId,
			secretAccessKey: appKey,
		},
		forcePathStyle: true, // B2 requires path-style addressing
	});
	return _client;
}

function getBucket() {
	const bucket = process.env.B2_BUCKET_NAME;
	if (!bucket) {
		throw Object.assign(new Error('B2 storage not configured'), { code: 'STORAGE_NOT_CONFIGURED' });
	}
	return bucket;
}

/**
 * Upload a file buffer to B2.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer - File contents
 * @param {string} opts.mimetype - File MIME type
 * @param {string} opts.filename - Original filename
 * @param {string} [opts.prefix] - Key prefix (default: 'rekrut')
 * @returns {Promise<{url: string, key: string}>} Public-serving URL (via our API) and the B2 key
 */
async function uploadToB2({ buffer, mimetype, filename, prefix = 'rekrut' }) {
	const client = getClient();
	const bucket = getBucket();

	// Unique key: prefix/timestamp-random-sanitizedFilename
	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
	const key = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

	try {
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: buffer,
				ContentType: mimetype,
			}),
		);
	} catch (err) {
		console.error('[b2-storage] Upload failed:', err.message);
		throw Object.assign(
			new Error('File storage service unavailable. Please try again later.'),
			{ code: 'STORAGE_UNAVAILABLE' },
		);
	}

	// Serve via our own API so we don't need public buckets or signed URLs
	return { url: `/api/files/${encodeURIComponent(key)}`, key };
}

/**
 * Fetch a file from B2 (for the /api/files/:key serving endpoint).
 *
 * @param {string} key - The B2 object key
 * @returns {Promise<{stream: Readable, contentType: string, contentLength?: number}>}
 */
async function getFromB2(key) {
	const client = getClient();
	const bucket = getBucket();

	try {
		const res = await client.send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
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
		console.error('[b2-storage] Fetch failed:', err.message);
		throw Object.assign(new Error('File storage service unavailable'), { code: 'STORAGE_UNAVAILABLE' });
	}
}

/**
 * Check B2 connectivity (for the /storage/health diagnostic endpoint).
 * @returns {Promise<{ok: boolean, code: string, message: string}>}
 */
async function checkB2Health() {
	try {
		getClient();
		getBucket();
	} catch (err) {
		return { ok: false, code: 'NOT_CONFIGURED', message: err.message };
	}

	// Lightweight check: try to fetch a nonexistent key. If we get 404/NoSuchKey,
	// auth worked. If we get 401/403, the key is bad.
	try {
		await getFromB2(`__health_check_${Date.now()}`);
		return { ok: true, code: 'OK', message: 'B2 reachable and credentials valid' };
	} catch (err) {
		if (err.code === 'NOT_FOUND') {
			return { ok: true, code: 'OK', message: 'B2 reachable and credentials valid' };
		}
		return { ok: false, code: err.code || 'ERROR', message: err.message };
	}
}

module.exports = { uploadToB2, getFromB2, checkB2Health };
