/**
 * Migration 231: users.deleted_at — soft-delete tombstone for account deletion.
 *
 * Issue #255 adds DELETE /api/auth/delete-account. Hard-deleting from users
 * is unsafe: dozens of FK references to users(id) have no ON DELETE behavior
 * (NO ACTION), so DELETE FROM users can fail with FK violations. Instead the
 * endpoint sets deleted_at and scrubs PII (email/name/password_hash/oauth ids),
 * keeping referential integrity. authMiddleware rejects deleted_at users.
 */
module.exports = {
	name: '231_add_users_deleted_at',
	up: async (client) => {
		await client.query(`
			ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
		`);
		console.log('[migration:231] users.deleted_at added');
	},
};
