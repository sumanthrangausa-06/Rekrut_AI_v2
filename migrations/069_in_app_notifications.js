// Migration: Add in-app notification table for pending recruiter join requests (Issue #155)

async function up(client) {
	// ─── user_notifications ─────────────────────────────────────────────────
	await client.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'join_request',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        read BOOLEAN NOT NULL DEFAULT false,
        read_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

	// ─── Indexes ───────────────────────────────────────────────────────────
	await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read_created 
        ON user_notifications(user_id, read, created_at DESC)
    `);
	await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_notifications_type 
        ON user_notifications(type, created_at DESC)
    `);

	console.log('[migration 069] In-app notifications table created');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS user_notifications CASCADE');
	console.log('[migration 069] In-app notifications table dropped');
}

module.exports = { up, down };
