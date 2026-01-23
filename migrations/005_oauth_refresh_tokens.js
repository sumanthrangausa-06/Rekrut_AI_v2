// Migration: OAuth & Refresh Tokens Support
// Adds tables for OAuth provider connections and refresh token rotation

module.exports = {
  name: '005_oauth_refresh_tokens',
  up: async (client) => {
    // OAuth provider connections
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        provider_user_id VARCHAR(255) NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        profile_data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(provider, provider_user_id)
      )
    `);

    // Refresh tokens for JWT rotation
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        family_id VARCHAR(100) NOT NULL,
        is_revoked BOOLEAN DEFAULT false,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP
      )
    `);

    // Add OAuth columns to users table if not exists
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS google_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS linkedin_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50)
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_connections_user ON oauth_connections(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_connections_provider ON oauth_connections(provider, provider_user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
    `);

    console.log('OAuth and refresh tokens tables created');
  }
};
