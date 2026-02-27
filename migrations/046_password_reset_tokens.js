/**
 * Password Reset Tokens Migration
 *
 * Adds password_reset_tokens table to support password reset functionality
 */
module.exports = {
  name: 'password_reset_tokens',
  up: async (client) => {
    await client.query(`
      CREATE TABLE password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ
      );

      CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
    `);
  },

  down: async (client) => {
    await client.query(`
      DROP TABLE IF EXISTS password_reset_tokens;
    `);
  }
};