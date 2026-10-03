/**
 * Migration 078: Chat schema enhancements
 * Issue #114 — Recruiter-candidate chat with read receipts and file attachments
 */

module.exports = {
	name: '078_chat_schema_enhancements',
	up: async (client) => {
		// Add missing columns to conversations for richer chat experience
		await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS job_title TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'
    `);

		// Index on messages.sender_id for performance
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)
    `);

		// Index on messages.conversation_id + created_at for fast message retrieval
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC)
    `);

		// Backfill job_title from jobs table
		await client.query(`
      UPDATE conversations c
      SET job_title = j.title
      FROM jobs j
      WHERE c.job_id = j.id AND c.job_title IS NULL
    `);

		console.log('Migration 078 completed: chat schema enhancements');
	},
};
