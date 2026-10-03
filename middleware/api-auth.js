const crypto = require('node:crypto');
const pool = require('../lib/db');

/**
 * API Key Authentication Middleware
 * Extracts X-API-Key header, SHA-256 hashes it, looks up in api_keys table.
 * Attaches req.apiKey with scopes and rate limit config if valid.
 */
async function apiAuthMiddleware(req, res, next) {
	const apiKey = req.headers['x-api-key'];

	if (!apiKey) {
		return res.status(401).json({ error: 'API key required', code: 'API_KEY_MISSING' });
	}

	const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

	try {
		const result = await pool.query(
			'SELECT id, name, scopes, rate_limit, is_active, created_by FROM api_keys WHERE key_hash = $1',
			[keyHash],
		);

		if (result.rows.length === 0) {
			return res.status(401).json({ error: 'Invalid API key', code: 'API_KEY_INVALID' });
		}

		const keyRecord = result.rows[0];

		if (!keyRecord.is_active) {
			return res.status(401).json({ error: 'API key revoked', code: 'API_KEY_REVOKED' });
		}

		// Update last_used_at (fire-and-forget, don't block)
		pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [keyRecord.id]).catch(() => {});

		req.apiKey = {
			id: keyRecord.id,
			name: keyRecord.name,
			scopes: keyRecord.scopes || [],
			rateLimit: keyRecord.rate_limit,
			createdBy: keyRecord.created_by,
		};

		next();
	} catch (err) {
		console.error('[api-auth] Error:', err.message);
		res.status(500).json({ error: 'Authentication error' });
	}
}

/**
 * Optional API Key Middleware — attaches req.apiKey if present and valid,
 * but does not reject the request if missing or invalid.
 */
async function optionalApiAuth(req, res, next) {
	const apiKey = req.headers['x-api-key'];
	if (!apiKey) return next();

	const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

	try {
		const result = await pool.query(
			'SELECT id, name, scopes, rate_limit, is_active, created_by FROM api_keys WHERE key_hash = $1',
			[keyHash],
		);

		if (result.rows.length > 0 && result.rows[0].is_active) {
			const keyRecord = result.rows[0];
			req.apiKey = {
				id: keyRecord.id,
				name: keyRecord.name,
				scopes: keyRecord.scopes || [],
				rateLimit: keyRecord.rate_limit,
				createdBy: keyRecord.created_by,
			};
			pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [keyRecord.id]).catch(() => {});
		}
	} catch (err) {
		// Silently ignore errors for optional auth
		console.error('[optional-api-auth] Error:', err.message);
	}
	next();
}

module.exports = { apiAuthMiddleware, optionalApiAuth };
