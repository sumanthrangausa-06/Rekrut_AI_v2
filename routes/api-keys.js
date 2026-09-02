const express = require('express');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// Only company owners and admins can manage API keys
function requireOwnerOrAdmin(req, res, next) {
	if (!req.user) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	const allowed = ['admin', 'owner'];
	// Also allow if user is the company owner
	if (allowed.includes(req.user.role)) return next();
	// Check if user owns a company
	if (req.user.company_id) {
		return pool
			.query('SELECT owner_id FROM companies WHERE id = $1', [req.user.company_id])
			.then((result) => {
				if (result.rows.length > 0 && result.rows[0].owner_id === req.user.id) {
					return next();
				}
				return res
					.status(403)
					.json({ error: 'Only company owners and admins can manage API keys' });
			})
			.catch((err) => {
				console.error('[api-keys] Owner check error:', err.message);
				res.status(500).json({ error: 'Failed to verify permissions' });
			});
	}
	return res.status(403).json({ error: 'Only company owners and admins can manage API keys' });
}

// POST /api/recruiter/api-keys — generate new key
router.post('/api-keys', authMiddleware, requireOwnerOrAdmin, async (req, res) => {
	try {
		const { name, scopes = ['read'], rate_limit = 60 } = req.body;

		if (!name || typeof name !== 'string' || name.trim().length === 0) {
			return res.status(400).json({ error: 'Name is required' });
		}

		// Generate raw key (prefix + random bytes)
		const rawKey = `rk_${crypto.randomBytes(32).toString('base64url')}`;
		const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

		const result = await pool.query(
			`INSERT INTO api_keys (key_hash, name, scopes, rate_limit, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, scopes, rate_limit, is_active, created_at`,
			[
				keyHash,
				name.trim(),
				JSON.stringify(Array.isArray(scopes) ? scopes : [scopes]),
				rate_limit,
				req.user.id,
			],
		);

		const keyRecord = result.rows[0];

		res.status(201).json({
			success: true,
			key: rawKey, // returned ONCE — client must save it
			id: keyRecord.id,
			name: keyRecord.name,
			scopes: keyRecord.scopes,
			rate_limit: keyRecord.rate_limit,
			is_active: keyRecord.is_active,
			created_at: keyRecord.created_at,
			warning: 'This key will not be shown again. Copy it now.',
		});
	} catch (err) {
		console.error('[api-keys] Create error:', err.message);
		res.status(500).json({ error: 'Failed to create API key' });
	}
});

// GET /api/recruiter/api-keys — list keys (masked, with usage stats)
router.get('/api-keys', authMiddleware, requireOwnerOrAdmin, async (req, res) => {
	try {
		const keysResult = await pool.query(
			`SELECT ak.id, ak.name, ak.scopes, ak.rate_limit, ak.is_active, ak.created_at, ak.last_used_at,
        COUNT(aku.id) as total_calls,
        COUNT(aku.id) FILTER (WHERE aku.created_at >= NOW() - INTERVAL '24 hours') as calls_24h
       FROM api_keys ak
       LEFT JOIN api_key_usage aku ON aku.api_key_id = ak.id
       WHERE ak.created_by = $1 AND ak.is_active = true
       GROUP BY ak.id
       ORDER BY ak.created_at DESC`,
			[req.user.id],
		);

		const keys = keysResult.rows.map((k) => ({
			id: k.id,
			name: k.name,
			scopes: k.scopes,
			rate_limit: k.rate_limit,
			is_active: k.is_active,
			created_at: k.created_at,
			last_used_at: k.last_used_at,
			usage: {
				total_calls: parseInt(k.total_calls, 10),
				calls_24h: parseInt(k.calls_24h, 10),
			},
		}));

		res.json({ success: true, keys });
	} catch (err) {
		console.error('[api-keys] List error:', err.message);
		res.status(500).json({ error: 'Failed to list API keys' });
	}
});

// DELETE /api/recruiter/api-keys/:id — revoke key
router.delete('/api-keys/:id', authMiddleware, requireOwnerOrAdmin, async (req, res) => {
	try {
		const keyId = parseInt(req.params.id, 10);
		if (Number.isNaN(keyId)) {
			return res.status(400).json({ error: 'Invalid key ID' });
		}

		// Verify ownership before revoking
		const existing = await pool.query('SELECT id FROM api_keys WHERE id = $1 AND created_by = $2', [
			keyId,
			req.user.id,
		]);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'API key not found' });
		}

		await pool.query('UPDATE api_keys SET is_active = false WHERE id = $1', [keyId]);

		res.json({ success: true, message: 'API key revoked' });
	} catch (err) {
		console.error('[api-keys] Revoke error:', err.message);
		res.status(500).json({ error: 'Failed to revoke API key' });
	}
});

module.exports = router;
