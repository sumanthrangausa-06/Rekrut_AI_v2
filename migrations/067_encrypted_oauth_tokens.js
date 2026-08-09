// Migration 067: Encrypted OAuth Token Storage
// Issue #127 — Calendar integration and automated interview scheduling
//
// Adds encryption_version tracking columns and ensures TEXT column types
// for both calendar_connections and oauth_connections so that AES-256-GCM
// ciphertext (which is base64 and ~1.3× the plaintext size) fits comfortably.
//
// Backward compatibility:
//   - Existing plaintext tokens remain readable (crypto-utils.decrypt passes
//     through any value lacking the "enc:v1:" prefix).
//   - New tokens are encrypted automatically by calendar-service.js and auth.js.
//
// Environment required:
//   ENCRYPTION_KEY — min 8 chars, SHA-256 hashed internally to 32 bytes.

module.exports = {
	up: async (client) => {
		// ── calendar_connections ──────────────────────────────────────────
		await client.query(`
			ALTER TABLE calendar_connections
			ADD COLUMN IF NOT EXISTS encryption_version VARCHAR(10) DEFAULT NULL
		`);

		await client.query(`
			ALTER TABLE calendar_connections
			ALTER COLUMN access_token TYPE TEXT
		`);

		await client.query(`
			ALTER TABLE calendar_connections
			ALTER COLUMN refresh_token TYPE TEXT
		`);

		// ── oauth_connections ─────────────────────────────────────────────
		await client.query(`
			ALTER TABLE oauth_connections
			ADD COLUMN IF NOT EXISTS encryption_version VARCHAR(10) DEFAULT NULL
		`);

		await client.query(`
			ALTER TABLE oauth_connections
			ALTER COLUMN access_token TYPE TEXT
		`);

		await client.query(`
			ALTER TABLE oauth_connections
			ALTER COLUMN refresh_token TYPE TEXT
		`);

		// ── Indexes for tracking migration status ─────────────────────────
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_calendar_connections_version
			ON calendar_connections(encryption_version)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_oauth_connections_version
			ON oauth_connections(encryption_version)
		`);

		console.log('Migration 067: Encrypted OAuth token storage schema updated');
	},
};
