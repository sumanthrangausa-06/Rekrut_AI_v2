/**
 * Chat Routes — Recruiter-Candidate Messaging (Issue #114)
 *
 * Endpoints:
 *   GET  /candidate/conversations        — list candidate's conversations
 *   GET  /recruiter/conversations        — list recruiter's company conversations
 *   GET  /conversations/:id/messages     — get messages (?after= for polling)
 *   POST /conversations/:id/messages     — send a message
 *   POST /conversations/:id/read         — mark messages as read
 *   POST /conversations/:id/upload       — upload file attachment
 *
 * Mounted at /api in server.js so frontend paths resolve correctly:
 *   /api/candidate/conversations, /api/recruiter/conversations, /api/conversations/...
 */

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// ─── Multer config (mirrors routes/documents.js) ──────────────────────────
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
	fileFilter: (_req, file, cb) => {
		const allowed = [
			'application/pdf',
			'image/jpeg',
			'image/jpg',
			'image/png',
			'image/webp',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'text/plain',
		];
		cb(null, allowed.includes(file.mimetype));
	},
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Verify a user is allowed to access a conversation.
 * Candidates: must be the conversation candidate.
 * Recruiters: must belong to the conversation's company.
 */
async function verifyConversationAccess(convId, userId) {
	const result = await pool.query(
		`SELECT
			c.*,
			j.title as job_title,
			cand.name as candidate_name,
			cand.email as candidate_email,
			rec.name as recruiter_name,
			rec.email as recruiter_email,
			comp.name as company_name
		FROM conversations c
		LEFT JOIN jobs j ON c.job_id = j.id
		LEFT JOIN users cand ON c.candidate_id = cand.id
		LEFT JOIN users rec ON c.recruiter_id = rec.id
		LEFT JOIN companies comp ON c.company_id = comp.id
		WHERE c.id = $1`,
		[convId],
	);
	if (result.rows.length === 0) return null;
	const conv = result.rows[0];

	// Candidate access
	if (conv.candidate_id === userId) return conv;

	// Recruiter / company access
	const userRes = await pool.query('SELECT role, company_id FROM users WHERE id = $1', [userId]);
	const user = userRes.rows[0];
	if (!user) return null;

	const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
	if (recruiterRoles.includes(user.role) && user.company_id === conv.company_id) {
		return conv;
	}

	return null;
}

/**
 * Get or create a conversation for a job application.
 * Used by candidate.js apply endpoint.
 */
async function getOrCreateConversation(jobId, candidateId, recruiterId, companyId) {
	const existing = await pool.query(
		`SELECT id FROM conversations
		 WHERE job_id = $1 AND candidate_id = $2 AND recruiter_id = $3`,
		[jobId, candidateId, recruiterId],
	);
	if (existing.rows.length > 0) return existing.rows[0].id;

	const jobRes = await pool.query('SELECT title FROM jobs WHERE id = $1', [jobId]);
	const jobTitle = jobRes.rows[0]?.title || null;

	const result = await pool.query(
		`INSERT INTO conversations
		 (job_id, job_title, candidate_id, recruiter_id, company_id, status, is_active)
		 VALUES ($1, $2, $3, $4, $5, 'active', true)
		 RETURNING id`,
		[jobId, jobTitle, candidateId, recruiterId, companyId],
	);
	return result.rows[0].id;
}

/**
 * Build a ChatMessage JSON object from a DB row.
 */
function buildChatMessage(row) {
	return {
		id: row.id,
		conversation_id: row.conversation_id,
		sender_id: row.sender_id,
		content: row.content,
		type: row.type || 'text',
		file_url: row.file_url || null,
		file_name: row.file_name || null,
		created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
		read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
		is_read: row.is_read || false,
		sender: row.sender_id
			? {
					id: row.sender_id,
					name: row.sender_name || 'Unknown',
					email: row.sender_email || '',
					role: row.sender_role || 'candidate',
				}
			: null,
	};
}

/**
 * Build a Conversation JSON object from a DB row.
 */
function buildConversation(row, mode) {
	const isCandidate = mode === 'candidate';
	return {
		id: row.id,
		job_id: row.job_id || null,
		job_title: row.job_title || row.company_name || null,
		candidate_id: row.candidate_id || null,
		candidate_name: row.candidate_name || null,
		recruiter_id: row.recruiter_id || null,
		recruiter_name: row.recruiter_name || null,
		company_name: row.company_name || null,
		last_message: row.last_message ? buildChatMessage(row.last_message) : null,
		unread_count: parseInt(row.unread_count, 10) || 0,
		is_active: row.is_active,
		created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
		updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
		other_user: isCandidate
			? row.recruiter_id
				? {
						id: row.recruiter_id,
						name: row.recruiter_name || 'Unknown',
						email: row.recruiter_email || '',
						role: 'recruiter',
						is_online: false,
					}
				: null
			: row.candidate_id
				? {
						id: row.candidate_id,
						name: row.candidate_name || 'Unknown',
						email: row.candidate_email || '',
						role: 'candidate',
						is_online: false,
					}
				: null,
	};
}

// ─── Routes ───────────────────────────────────────────────────────────────

// GET /candidate/conversations
router.get('/candidate/conversations', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`SELECT
				c.id,
				c.job_id,
				c.job_title,
				c.candidate_id,
				cand.name as candidate_name,
				c.recruiter_id,
				rec.name as recruiter_name,
				rec.email as recruiter_email,
				comp.name as company_name,
				c.unread_count_candidate as unread_count,
				c.is_active,
				c.status,
				c.created_at,
				c.updated_at,
				(
					SELECT json_build_object(
						'id', m.id,
						'conversation_id', m.conversation_id,
						'sender_id', m.sender_id,
						'content', m.content,
						'type', m.type,
						'file_url', m.file_url,
						'file_name', m.file_name,
						'created_at', m.created_at,
						'read_at', m.read_at,
						'is_read', m.is_read,
						'sender_name', sender.name,
						'sender_email', sender.email,
						'sender_role', sender.role
					)
					FROM messages m
					LEFT JOIN users sender ON m.sender_id = sender.id
					WHERE m.conversation_id = c.id
					ORDER BY m.created_at DESC
					LIMIT 1
				) as last_message
			FROM conversations c
			LEFT JOIN users cand ON c.candidate_id = cand.id
			LEFT JOIN users rec ON c.recruiter_id = rec.id
			LEFT JOIN companies comp ON c.company_id = comp.id
			WHERE c.candidate_id = $1 AND c.is_active = true
			ORDER BY c.updated_at DESC NULLS LAST
			LIMIT 50`,
			[userId],
		);

		const conversations = result.rows.map((r) => buildConversation(r, 'candidate'));
		res.json({ conversations });
	} catch (err) {
		console.error('Get candidate conversations error:', err);
		res.status(500).json({ error: 'Failed to fetch conversations' });
	}
});

// GET /recruiter/conversations
router.get('/recruiter/conversations', authMiddleware, async (req, res) => {
	try {
		const user = req.user;
		const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
		if (!recruiterRoles.includes(user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}
		if (!user.company_id) {
			return res.status(403).json({ error: 'No company associated' });
		}

		const result = await pool.query(
			`SELECT
				c.id,
				c.job_id,
				c.job_title,
				c.candidate_id,
				cand.name as candidate_name,
				cand.email as candidate_email,
				c.recruiter_id,
				rec.name as recruiter_name,
				comp.name as company_name,
				c.unread_count_recruiter as unread_count,
				c.is_active,
				c.status,
				c.created_at,
				c.updated_at,
				(
					SELECT json_build_object(
						'id', m.id,
						'conversation_id', m.conversation_id,
						'sender_id', m.sender_id,
						'content', m.content,
						'type', m.type,
						'file_url', m.file_url,
						'file_name', m.file_name,
						'created_at', m.created_at,
						'read_at', m.read_at,
						'is_read', m.is_read,
						'sender_name', sender.name,
						'sender_email', sender.email,
						'sender_role', sender.role
					)
					FROM messages m
					LEFT JOIN users sender ON m.sender_id = sender.id
					WHERE m.conversation_id = c.id
					ORDER BY m.created_at DESC
					LIMIT 1
				) as last_message
			FROM conversations c
			LEFT JOIN users cand ON c.candidate_id = cand.id
			LEFT JOIN users rec ON c.recruiter_id = rec.id
			LEFT JOIN companies comp ON c.company_id = comp.id
			WHERE c.company_id = $1 AND c.is_active = true
			ORDER BY c.updated_at DESC NULLS LAST
			LIMIT 50`,
			[user.company_id],
		);

		const conversations = result.rows.map((r) => buildConversation(r, 'recruiter'));
		res.json({ conversations });
	} catch (err) {
		console.error('Get recruiter conversations error:', err);
		res.status(500).json({ error: 'Failed to fetch conversations' });
	}
});

// GET /conversations/:id/messages
router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id, 10);
		if (Number.isNaN(conversationId)) {
			return res.status(400).json({ error: 'Invalid conversation ID' });
		}

		const userId = req.user.id;
		const conv = await verifyConversationAccess(conversationId, userId);
		if (!conv) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const after = req.query.after ? parseInt(req.query.after, 10) : null;

		let query = `
			SELECT
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
				u.name as sender_name,
				u.email as sender_email,
				u.role as sender_role
			FROM messages m
			LEFT JOIN users u ON m.sender_id = u.id
			WHERE m.conversation_id = $1
		`;
		const params = [conversationId];

		if (after && !Number.isNaN(after)) {
			query += ` AND m.id > $2`;
			params.push(after);
		}

		query += ` ORDER BY m.created_at ASC LIMIT 200`;

		const result = await pool.query(query, params);
		const messages = result.rows.map((r) => buildChatMessage(r));

		res.json({ messages });
	} catch (err) {
		console.error('Get messages error:', err);
		res.status(500).json({ error: 'Failed to fetch messages' });
	}
});

// POST /conversations/:id/messages
router.post('/conversations/:id/messages', authMiddleware, async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id, 10);
		if (Number.isNaN(conversationId)) {
			return res.status(400).json({ error: 'Invalid conversation ID' });
		}

		const userId = req.user.id;
		const conv = await verifyConversationAccess(conversationId, userId);
		if (!conv) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const { content, type = 'text' } = req.body;
		if (!content || typeof content !== 'string') {
			return res.status(400).json({ error: 'Content is required' });
		}

		const validTypes = ['text', 'file', 'image', 'system'];
		const messageType = validTypes.includes(type) ? type : 'text';

		const result = await pool.query(
			`INSERT INTO messages (conversation_id, sender_id, content, type)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
			[conversationId, userId, content, messageType],
		);
		const message = result.rows[0];

		// Update conversation timestamp
		await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

		// Increment unread count for the OTHER party
		const isCandidate = userId === conv.candidate_id;
		const unreadColumn = isCandidate ? 'unread_count_recruiter' : 'unread_count_candidate';
		await pool.query(
			`UPDATE conversations SET ${unreadColumn} = COALESCE(${unreadColumn}, 0) + 1 WHERE id = $1`,
			[conversationId],
		);

		// Get sender info for response
		const senderRes = await pool.query('SELECT name, email, role FROM users WHERE id = $1', [userId]);
		const sender = senderRes.rows[0] || {};

		res.json({
			message: {
				...buildChatMessage(message),
				sender: {
					id: userId,
					name: sender.name || 'Unknown',
					email: sender.email || '',
					role: sender.role || 'candidate',
				},
			},
		});
	} catch (err) {
		console.error('Send message error:', err);
		res.status(500).json({ error: 'Failed to send message' });
	}
});

// POST /conversations/:id/read
router.post('/conversations/:id/read', authMiddleware, async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id, 10);
		if (Number.isNaN(conversationId)) {
			return res.status(400).json({ error: 'Invalid conversation ID' });
		}

		const userId = req.user.id;
		const conv = await verifyConversationAccess(conversationId, userId);
		if (!conv) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Mark all other-party messages as read
		await pool.query(
			`UPDATE messages
			 SET is_read = true, read_at = NOW()
			 WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
			[conversationId, userId],
		);

		// Reset unread count for current user
		const isCandidate = userId === conv.candidate_id;
		const unreadColumn = isCandidate ? 'unread_count_candidate' : 'unread_count_recruiter';
		await pool.query(`UPDATE conversations SET ${unreadColumn} = 0 WHERE id = $1`, [conversationId]);

		res.json({ success: true });
	} catch (err) {
		console.error('Mark as read error:', err);
		res.status(500).json({ error: 'Failed to mark as read' });
	}
});

// POST /conversations/:id/upload
router.post('/conversations/:id/upload', authMiddleware, upload.single('file'), async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id, 10);
		if (Number.isNaN(conversationId)) {
			return res.status(400).json({ error: 'Invalid conversation ID' });
		}

		const userId = req.user.id;
		const conv = await verifyConversationAccess(conversationId, userId);
		if (!conv) {
			return res.status(403).json({ error: 'Access denied' });
		}

		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		// Upload to R2 via Polsia proxy
		const formData = new FormData();
		formData.append('file', req.file.buffer, {
			filename: req.file.originalname,
			contentType: req.file.mimetype,
		});

		const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
				...formData.getHeaders(),
			},
			body: formData,
		});

		const uploadResult = await uploadRes.json();
		if (!uploadResult.success) {
			throw new Error(uploadResult.error?.message || 'File upload failed');
		}

		const fileUrl = uploadResult.file.url;
		const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 'file';

		// Insert message with file attachment
		const result = await pool.query(
			`INSERT INTO messages
			 (conversation_id, sender_id, content, type, file_url, file_name)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING *`,
			[
				conversationId,
				userId,
				`Sent ${fileType}: ${req.file.originalname}`,
				fileType,
				fileUrl,
				req.file.originalname,
			],
		);
		const message = result.rows[0];

		// Update conversation
		await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

		// Increment unread for other party
		const isCandidate = userId === conv.candidate_id;
		const unreadColumn = isCandidate ? 'unread_count_recruiter' : 'unread_count_candidate';
		await pool.query(
			`UPDATE conversations SET ${unreadColumn} = COALESCE(${unreadColumn}, 0) + 1 WHERE id = $1`,
			[conversationId],
		);

		// Get sender info
		const senderRes = await pool.query('SELECT name, email, role FROM users WHERE id = $1', [userId]);
		const sender = senderRes.rows[0] || {};

		res.json({
			success: true,
			message: {
				...buildChatMessage(message),
				sender: {
					id: userId,
					name: sender.name || 'Unknown',
					email: sender.email || '',
					role: sender.role || 'candidate',
				},
			},
		});
	} catch (err) {
		console.error('Upload error:', err);
		res.status(500).json({ error: 'Failed to upload file' });
	}
});

module.exports = { router, getOrCreateConversation };
