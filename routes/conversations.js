// Conversations / Chat Routes (Issue #109)
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const pool = require('../lib/db');

const router = express.Router();

// GET /api/conversations/:id/messages
router.get('/:id/messages', authMiddleware, async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id, 10);
		if (Number.isNaN(conversationId)) {
			return res.status(400).json({ error: 'Invalid conversation ID' });
		}

		const userId = req.user.id;

		// Verify user is a participant in this conversation
		const convResult = await pool.query(
			`SELECT id, candidate_id, recruiter_id FROM conversations WHERE id = $1`,
			[conversationId],
		);

		if (convResult.rows.length === 0) {
			return res.status(404).json({ error: 'Conversation not found' });
		}

		const conv = convResult.rows[0];
		if (conv.candidate_id !== userId && conv.recruiter_id !== userId) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const result = await pool.query(
			`SELECT
				m.id,
				m.conversation_id,
				m.sender_id,
				m.content,
				m.type,
				m.file_url,
				m.file_name,
				m.created_at,
				m.read_at,
				m.is_read,
				u.name as sender_name
			FROM messages m
			LEFT JOIN users u ON m.sender_id = u.id
			WHERE m.conversation_id = $1
			ORDER BY m.created_at ASC
			LIMIT 200`,
			[conversationId],
		);

		const messages = result.rows.map((m) => ({
			id: String(m.id),
			conversation_id: m.conversation_id ? String(m.conversation_id) : null,
			sender_id: m.sender_id ? String(m.sender_id) : null,
			content: m.content,
			type: m.type || 'text',
			file_url: m.file_url || null,
			file_name: m.file_name || null,
			created_at: m.created_at ? new Date(m.created_at).toISOString() : null,
			read_at: m.read_at ? new Date(m.read_at).toISOString() : null,
			is_read: m.is_read || false,
			sender: {
				id: m.sender_id ? String(m.sender_id) : null,
				name: m.sender_name || 'Unknown',
			},
		}));

		// Mark messages as read for the current user
		await pool.query(
			`UPDATE messages SET is_read = true, read_at = NOW()
			 WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
			[conversationId, userId],
		);

		res.json({ messages });
	} catch (err) {
		console.error('Get messages error:', err);
		res.status(500).json({ error: 'Failed to fetch messages' });
	}
});

module.exports = router;
