/**
 * Migration 230: oauth_exchange_codes — one-time codes bridging OAuth to SPA auth.
 *
 * The OAuth callbacks mint the app's access/refresh tokens, but the SPA only
 * reads credentials from localStorage. Instead of leaking tokens through the
 * URL, the callback stores them server-side against a random single-use code
 * (5-minute expiry) and redirects to {dest}?oauth_code=<code>. The frontend
 * trades the code for tokens via POST /api/auth/oauth/exchange.
 *
 * Security notes:
 * - code_hash stores sha256(code); the raw code is never persisted.
 * - Rows are DELETEd (not flagged) on successful exchange, so the plaintext
 *   token material lives in the DB for at most 5 minutes and is gone after use.
 * - The exchange endpoint consumes the row atomically
 *   (DELETE ... WHERE code_hash AND expires_at > NOW() ... RETURNING),
 *   so concurrent double-submits cannot both succeed.
 */
module.exports = {
	name: '230_oauth_exchange_codes',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
				id SERIAL PRIMARY KEY,
				code_hash VARCHAR(64) UNIQUE NOT NULL,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				dest VARCHAR(512) NOT NULL DEFAULT '/candidate',
				expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_oauth_exchange_codes_expires
			ON oauth_exchange_codes (expires_at)
		`);
		console.log('[migration:230] oauth_exchange_codes created');
	},
};
