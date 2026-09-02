/**
 * Migration 072: Add conversations, messages, and saved_searches tables
 * Issue #109 — Missing API endpoints for chat, saved-searches, screenings
 */

const { Pool } = require('pg');

const _pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = {
	name: '072_add_conversations_messages_saved_searches',
	up: async (client) => {
		// Conversations table
		await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        last_message TEXT,
        last_message_at TIMESTAMP,
        unread_count_candidate INTEGER DEFAULT 0,
        unread_count_recruiter INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_candidate ON conversations(candidate_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_recruiter ON conversations(recruiter_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_company ON conversations(company_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)
    `);

		// Messages table
		await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'text',
        file_url TEXT,
        file_name TEXT,
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)
    `);

		// Saved searches table
		await client.query(`
      CREATE TABLE IF NOT EXISTS saved_searches (
        id SERIAL PRIMARY KEY,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        filters JSONB DEFAULT '{}',
        search_query TEXT,
        alert_enabled BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_searches_recruiter ON saved_searches(recruiter_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_searches_company ON saved_searches(company_id)
    `);

		console.log('Migration 072 completed: conversations, messages, saved_searches tables created');
	},
};
