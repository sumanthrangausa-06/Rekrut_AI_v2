/**
 * Polsia R2 upload helper with API key rotation.
 *
 * Issue #234 follow-up: the app previously used a single POLSIA_API_KEY for all
 * R2 uploads (resume, photo, documents, chat attachments, interview recordings).
 * When that key was rejected, every upload failed with no fallback.
 *
 * Now supports POLSIA_API_KEY (primary) plus POLSIA_API_KEY_2, POLSIA_API_KEY_3,
 * ... as fallbacks. On 401/403 (key rejected), the next key is tried automatically.
 * Missing fallback keys are fine — the helper just uses what's configured.
 */

/**
 * Collect all configured Polsia API keys in priority order.
 * @returns {string[]} Array of keys, primary first.
 */
function getPolsiaKeys() {
	const keys = [];
	if (process.env.POLSIA_API_KEY) {
		keys.push(process.env.POLSIA_API_KEY);
	}
	for (let i = 2; ; i++) {
		const key = process.env[`POLSIA_API_KEY_${i}`];
		if (!key) break;
		keys.push(key);
	}
	return keys;
}

const R2_UPLOAD_URL = 'https://polsia.com/api/proxy/r2/upload';

/**
 * Upload a file buffer to R2 via the Polsia proxy, rotating API keys on auth failure.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer - File contents
 * @param {string} opts.mimetype - File MIME type
 * @param {string} opts.filename - Original filename
 * @returns {Promise<{url: string, keyIndex: number}>} The uploaded file URL and which key (1-based) succeeded
 * @throws {Error} With `.code` set to one of: NO_API_KEY, STORAGE_AUTH_FAILED,
 *                 STORAGE_UNAVAILABLE, STORAGE_UNREACHABLE, STORAGE_BAD_RESPONSE
 */
async function uploadToR2({ buffer, mimetype, filename }) {
	const keys = getPolsiaKeys();
	if (keys.length === 0) {
		throw Object.assign(new Error('No Polsia API keys configured'), { code: 'NO_API_KEY' });
	}

	let lastAuthError = null;

	for (let i = 0; i < keys.length; i++) {
		// Fresh FormData per attempt — a consumed body can't be re-sent
		const formData = new FormData();
		formData.append('file', new Blob([buffer], { type: mimetype }), filename);

		let res;
		try {
			res = await fetch(R2_UPLOAD_URL, {
				method: 'POST',
				headers: { Authorization: `Bearer ${keys[i]}` },
				body: formData,
			});
		} catch (networkErr) {
			// Network-level failure (DNS, timeout, connection refused) — the proxy
			// itself is unreachable, so rotating keys won't help.
			throw Object.assign(
				new Error(`File storage service unreachable: ${networkErr.message}`),
				{ code: 'STORAGE_UNREACHABLE' },
			);
		}

		if (res.status === 401 || res.status === 403) {
			// This key is rejected — try the next one
			console.warn(`[polsia-upload] API key ${i + 1} rejected (${res.status}), trying next key`);
			lastAuthError = Object.assign(
				new Error('File storage authentication failed'),
				{ code: 'STORAGE_AUTH_FAILED', status: res.status },
			);
			continue;
		}

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			console.error(`[polsia-upload] Proxy error: ${res.status}`, text.slice(0, 200));
			throw Object.assign(
				new Error('File storage service unavailable. Please try again later.'),
				{ code: 'STORAGE_UNAVAILABLE', status: res.status },
			);
		}

		const result = await res.json().catch(() => null);
		if (!result?.success || !result?.file?.url) {
			console.error('[polsia-upload] Bad proxy response:', JSON.stringify(result)?.slice(0, 200));
			throw Object.assign(
				new Error('File storage returned an unexpected response. Please try again later.'),
				{ code: 'STORAGE_BAD_RESPONSE' },
			);
		}

		if (i > 0) {
			console.info(`[polsia-upload] Upload succeeded with fallback key ${i + 1}`);
		}
		return { url: result.file.url, keyIndex: i + 1 };
	}

	// Every configured key was rejected
	throw lastAuthError || Object.assign(
		new Error('File storage authentication failed. Please try again later.'),
		{ code: 'STORAGE_AUTH_FAILED' },
	);
}

/**
 * Test each configured Polsia API key individually against the proxy.
 * Used by the /storage/health diagnostic endpoint.
 *
 * @returns {Promise<Array<{index: number, ok: boolean, code: string, status?: number, message?: string}>>}
 */
async function checkPolsiaKeys() {
	const keys = getPolsiaKeys();
	const results = [];

	for (let i = 0; i < keys.length; i++) {
		try {
			const res = await fetch(R2_UPLOAD_URL, {
				method: 'POST',
				headers: { Authorization: `Bearer ${keys[i]}` },
			});
			if (res.status === 401 || res.status === 403) {
				results.push({ index: i + 1, ok: false, code: 'AUTH_FAILED', status: res.status });
			} else {
				results.push({ index: i + 1, ok: true, code: 'OK', status: res.status });
			}
		} catch (err) {
			results.push({ index: i + 1, ok: false, code: 'UNREACHABLE', message: err.message });
		}
	}

	return results;
}

module.exports = { getPolsiaKeys, uploadToR2, checkPolsiaKeys };
