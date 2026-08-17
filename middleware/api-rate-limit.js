const pool = require('../lib/db');

// ponytail: in-memory rate limiter. Upgrade to Redis if multi-instance or high throughput.
const _windows = new Map(); // key -> { count, resetAt }

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_LIMIT = 60;

function _getWindow(key, limit) {
	const now = Date.now();
	const existing = _windows.get(key);

	if (!existing || existing.resetAt <= now) {
		const windowData = { count: 1, resetAt: now + DEFAULT_WINDOW_MS, limit };
		_windows.set(key, windowData);
		return { windowData, remaining: limit - 1, resetAt: windowData.resetAt };
	}

	existing.count += 1;
	return { windowData: existing, remaining: Math.max(0, existing.limit - existing.count), resetAt: existing.resetAt };
}

// Periodic cleanup of expired windows to prevent memory leak
setInterval(() => {
	const now = Date.now();
	for (const [key, data] of _windows) {
		if (data.resetAt <= now) _windows.delete(key);
	}
}, 60_000);

/**
 * Rate limiting middleware.
 * Uses req.apiKey.rateLimit if apiKey is present, otherwise falls back to default.
 * Logs usage to api_key_usage table asynchronously (fire-and-forget).
 */
function apiRateLimit(req, res, next) {
	const keyId = req.apiKey?.id;
	const limit = req.apiKey?.rateLimit ?? DEFAULT_LIMIT;
	const key = keyId ? `apikey:${keyId}` : `ip:${req.ip}`;

	const { windowData, remaining, resetAt } = _getWindow(key, limit);

	res.setHeader('X-RateLimit-Limit', limit);
	res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
	res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

	if (windowData.count > limit) {
		const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
		res.setHeader('Retry-After', retryAfter);

		// Log the 429 to usage table async (don't block)
		if (keyId) {
			_logUsage(keyId, req.path, req.method, 429, null).catch(() => {});
		}

		return res.status(429).json({
			error: 'Rate limit exceeded',
			code: 'RATE_LIMIT_EXCEEDED',
			retry_after: retryAfter,
		});
	}

	// Attach usage logger so downstream handlers can log successful responses
	res.on('finish', () => {
		if (keyId) {
			const responseTime = req._startAt ? Date.now() - req._startAt : null;
			_logUsage(keyId, req.path, req.method, res.statusCode, responseTime).catch(() => {});
		}
	});

	req._startAt = Date.now();
	next();
}

async function _logUsage(apiKeyId, endpoint, method, statusCode, responseTimeMs) {
	try {
		await pool.query(
			`INSERT INTO api_key_usage (api_key_id, endpoint, method, status_code, response_time_ms)
       VALUES ($1, $2, $3, $4, $5)`,
			[apiKeyId, endpoint.slice(0, 255), method, statusCode, responseTimeMs],
		);
	} catch (err) {
		// Non-critical: don't crash on usage logging failure
		console.error('[api-rate-limit] Usage log failed:', err.message);
	}
}

module.exports = { apiRateLimit };
