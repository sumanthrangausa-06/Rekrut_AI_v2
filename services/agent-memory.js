const { Pool } = require('pg');
const { sanitizeHtml } = require('../lib/security');

/**
 * Simple cross-agent memory service
 * Provides store/retrieve functionality for agent context and tasks
 * Can be upgraded to full memU when Python 3.13+ is available
 */
class AgentMemoryService {
	constructor() {
		this.pool = new Pool({
			connectionString: process.env.DATABASE_URL,
		});
	}

	async init() {
		const client = await this.pool.connect();
		try {
			await client.query(`
				CREATE TABLE IF NOT EXISTS agent_memory (
					id SERIAL PRIMARY KEY,
					agent_id VARCHAR(64) NOT NULL,
					agent_type VARCHAR(32) NOT NULL,
					category VARCHAR(32) NOT NULL DEFAULT 'general',
					content TEXT NOT NULL,
					metadata JSONB DEFAULT '{}',
					importance INTEGER DEFAULT 1,
					created_at TIMESTAMP DEFAULT NOW(),
					updated_at TIMESTAMP DEFAULT NOW(),
					expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 days'
				);
			`);
			await client.query(`
				CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
			`);
			await client.query(`
				CREATE INDEX IF NOT EXISTS idx_agent_memory_category ON agent_memory(category);
			`);
			await client.query(`
				CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(created_at DESC);
			`);
			console.log('[AgentMemory] Database initialized');
		} finally {
			client.release();
		}
	}

	/**
	 * Store a memory entry for an agent
	 */
	async store(agentId, agentType, content, category = 'general', metadata = {}, importance = 1) {
		const client = await this.pool.connect();
		try {
			const sanitized = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });
			const result = await client.query(
				`INSERT INTO agent_memory (agent_id, agent_type, category, content, metadata, importance)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 RETURNING id, created_at`,
				[agentId, agentType, category, sanitized, JSON.stringify(metadata), importance]
			);
			return { id: result.rows[0].id, createdAt: result.rows[0].created_at };
		} finally {
			client.release();
		}
	}

	/**
	 * Retrieve recent memories for an agent
	 */
	async retrieve(agentId, category = null, limit = 10) {
		const client = await this.pool.connect();
		try {
			let query = `SELECT * FROM agent_memory WHERE agent_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`;
			let params = [agentId];
			if (category) {
				query += ` AND category = $2`;
				params.push(category);
			}
			query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
			params.push(limit);
			const result = await client.query(query, params);
			return result.rows.map(row => ({
				id: row.id,
				agentId: row.agent_id,
				agentType: row.agent_type,
				category: row.category,
				content: row.content,
				metadata: row.metadata,
				importance: row.importance,
				createdAt: row.created_at,
			}));
		} finally {
			client.release();
		}
	}

	/**
	 * Search memories across all agents
	 */
	async search(query, category = null, limit = 20) {
		const client = await this.pool.connect();
		try {
			let sql = `SELECT * FROM agent_memory WHERE content ILIKE $1 AND (expires_at IS NULL OR expires_at > NOW())`;
			let params = [`%${query}%`];
			if (category) {
				sql += ` AND category = $2`;
				params.push(category);
			}
			sql += ` ORDER BY importance DESC, created_at DESC LIMIT $${params.length + 1}`;
			params.push(limit);
			const result = await client.query(sql, params);
			return result.rows.map(row => ({
				id: row.id,
				agentId: row.agent_id,
				agentType: row.agent_type,
				category: row.category,
				content: row.content,
				metadata: row.metadata,
				importance: row.importance,
				createdAt: row.created_at,
			}));
		} finally {
			client.release();
		}
	}

	/**
	 * Delete old/expired memories
	 */
	async cleanup() {
		const client = await this.pool.connect();
		try {
			const result = await client.query(
				`DELETE FROM agent_memory WHERE expires_at < NOW() RETURNING id`
			);
			return { deleted: result.rowCount };
		} finally {
			client.release();
		}
	}

	/**
	 * Health check
	 */
	async healthCheck() {
		try {
			const client = await this.pool.connect();
			await client.query('SELECT 1');
			client.release();
			return { healthy: true };
		} catch (err) {
			return { healthy: false, error: err.message };
		}
	}
}

module.exports = { AgentMemoryService };
