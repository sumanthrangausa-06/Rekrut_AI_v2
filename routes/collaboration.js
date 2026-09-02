/**
 * Collaboration Routes — Real-time hiring team collaboration (Issue #128)
 *
 * Endpoints:
 * - GET  /api/collaboration/comments?entity_type=&entity_id=
 * - POST /api/collaboration/comments
 * - PUT  /api/collaboration/comments/:id
 * - DELETE /api/collaboration/comments/:id
 * - GET  /api/collaboration/notes?candidate_id=
 * - POST /api/collaboration/notes
 * - PUT  /api/collaboration/notes/:id
 * - DELETE /api/collaboration/notes/:id
 * - GET  /api/collaboration/activity/:jobId
 */

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// ─── Authorization ────────────────────────────────────────────────────────

/** Reject candidates — collaboration is hiring-team only */
function requireHiringTeam(req, res, next) {
	if (req.user.role === 'candidate') {
		return res.status(403).json({ error: 'Candidates cannot access collaboration features' });
	}
	next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse @username mentions from text */
function parseMentions(text) {
	if (!text) return [];
	const matches = text.match(/@(\w+)/g);
	if (!matches) return [];
	return [...new Set(matches.map((m) => m.slice(1)))]; // dedupe, strip @
}

/** Resolve @mentions to user IDs by matching against user name */
async function resolveMentions(usernames) {
	if (usernames.length === 0) return [];
	// ponytail: match against user name (no username column in users table)
	const result = await pool.query(`SELECT id, name FROM users WHERE name = ANY($1)`, [usernames]);
	return result.rows;
}

/** Insert in-app notifications for mentions */
async function notifyMentions(commentId, entityType, entityId, authorName, content, mentions) {
	if (mentions.length === 0) return;
	const snippet = content.length > 100 ? `${content.slice(0, 100)}…` : content;
	for (const user of mentions) {
		try {
			await pool.query(
				`INSERT INTO user_notifications
           (user_id, type, title, message, metadata)
         VALUES ($1, 'mention', $2, $3, $4)`,
				[
					user.id,
					`@${authorName} mentioned you in a comment`,
					snippet,
					JSON.stringify({ comment_id: commentId, entity_type: entityType, entity_id: entityId }),
				],
			);
		} catch (err) {
			console.error('[collaboration] Mention notify error:', err.message);
		}
	}
}

/** Log hiring activity */
async function _logActivity(jobId, userId, actionType, description, metadata = {}) {
	try {
		await pool.query(
			`INSERT INTO hiring_activity (job_id, user_id, action_type, description, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
			[jobId, userId, actionType, description, JSON.stringify(metadata)],
		);
	} catch (err) {
		console.error('[collaboration] Activity log error:', err.message);
	}
}

// ─── Comments ─────────────────────────────────────────────────────────────

/**
 * GET /api/collaboration/comments?entity_type=&entity_id=
 * List comments with nested replies, author info.
 */
router.get('/comments', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const { entity_type, entity_id } = req.query;
		if (!entity_type || !entity_id) {
			return res.status(400).json({ error: 'entity_type and entity_id are required' });
		}
		if (!['candidate', 'application'].includes(entity_type)) {
			return res.status(400).json({ error: 'entity_type must be candidate or application' });
		}

		const result = await pool.query(
			`SELECT
        c.id, c.entity_type, c.entity_id, c.parent_id, c.author_id,
        c.content, c.deleted, c.created_at, c.updated_at,
        u.name as author_name, u.avatar_url as author_avatar
      FROM comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.entity_type = $1 AND c.entity_id = $2
      ORDER BY c.created_at ASC`,
			[entity_type, parseInt(entity_id, 10)],
		);

		// Nest replies under parents
		const root = [];
		const map = new Map();
		for (const row of result.rows) {
			row.replies = [];
			map.set(row.id, row);
		}
		for (const row of result.rows) {
			if (row.parent_id && map.has(row.parent_id)) {
				map.get(row.parent_id).replies.push(row);
			} else {
				root.push(row);
			}
		}

		res.json({ success: true, comments: root });
	} catch (err) {
		console.error('[collaboration] List comments error:', err.message);
		res.status(500).json({ error: 'Failed to fetch comments' });
	}
});

/**
 * POST /api/collaboration/comments
 * Create a comment, parse @mentions, notify mentioned users.
 */
router.post('/comments', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const { entity_type, entity_id, parent_id, content } = req.body;
		if (!entity_type || !entity_id || !content || content.trim().length === 0) {
			return res.status(400).json({ error: 'entity_type, entity_id, and content are required' });
		}
		if (!['candidate', 'application'].includes(entity_type)) {
			return res.status(400).json({ error: 'entity_type must be candidate or application' });
		}

		// Verify parent exists and belongs to same entity
		if (parent_id) {
			const parentCheck = await pool.query(
				`SELECT id FROM comments WHERE id = $1 AND entity_type = $2 AND entity_id = $3`,
				[parent_id, entity_type, parseInt(entity_id, 10)],
			);
			if (parentCheck.rows.length === 0) {
				return res.status(400).json({ error: 'Parent comment not found' });
			}
		}

		const result = await pool.query(
			`INSERT INTO comments (entity_type, entity_id, parent_id, author_id, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
			[entity_type, parseInt(entity_id, 10), parent_id || null, req.user.id, content.trim()],
		);
		const comment = result.rows[0];

		// Parse and resolve mentions
		const usernames = parseMentions(content);
		const mentions = await resolveMentions(usernames);
		if (mentions.length > 0) {
			// Store mention records
			for (const user of mentions) {
				await pool.query(
					`INSERT INTO comment_mentions (comment_id, mentioned_user_id)
           VALUES ($1, $2)
           ON CONFLICT (comment_id, mentioned_user_id) DO NOTHING`,
					[comment.id, user.id],
				);
			}
			await notifyMentions(
				comment.id,
				entity_type,
				entity_id,
				req.user.name || req.user.email,
				content,
				mentions,
			);
		}

		// Attach author info for response
		comment.author_name = req.user.name;
		comment.author_avatar = req.user.avatar_url;
		comment.replies = [];

		res.status(201).json({ success: true, comment });
	} catch (err) {
		console.error('[collaboration] Create comment error:', err.message);
		res.status(500).json({ error: 'Failed to create comment' });
	}
});

/**
 * PUT /api/collaboration/comments/:id
 * Edit own comment.
 */
router.put('/comments/:id', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const commentId = parseInt(req.params.id, 10);
		const { content } = req.body;
		if (!content || content.trim().length === 0) {
			return res.status(400).json({ error: 'content is required' });
		}

		// Verify ownership
		const check = await pool.query(`SELECT author_id FROM comments WHERE id = $1`, [commentId]);
		if (check.rows.length === 0) {
			return res.status(404).json({ error: 'Comment not found' });
		}
		if (check.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'You can only edit your own comments' });
		}

		const result = await pool.query(
			`UPDATE comments
       SET content = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
			[content.trim(), commentId],
		);

		res.json({ success: true, comment: result.rows[0] });
	} catch (err) {
		console.error('[collaboration] Update comment error:', err.message);
		res.status(500).json({ error: 'Failed to update comment' });
	}
});

/**
 * DELETE /api/collaboration/comments/:id
 * Soft-delete own comment.
 */
router.delete('/comments/:id', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const commentId = parseInt(req.params.id, 10);

		const check = await pool.query(`SELECT author_id FROM comments WHERE id = $1`, [commentId]);
		if (check.rows.length === 0) {
			return res.status(404).json({ error: 'Comment not found' });
		}
		if (check.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'You can only delete your own comments' });
		}

		await pool.query(
			`UPDATE comments SET deleted = true, content = '[deleted]', updated_at = NOW() WHERE id = $1`,
			[commentId],
		);

		res.json({ success: true, deleted: true });
	} catch (err) {
		console.error('[collaboration] Delete comment error:', err.message);
		res.status(500).json({ error: 'Failed to delete comment' });
	}
});

// ─── Shared Notes ─────────────────────────────────────────────────────────

/**
 * GET /api/collaboration/notes?candidate_id=
 */
router.get('/notes', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const { candidate_id } = req.query;
		if (!candidate_id) {
			return res.status(400).json({ error: 'candidate_id is required' });
		}

		const result = await pool.query(
			`SELECT
        sn.id, sn.candidate_id, sn.author_id, sn.content, sn.rating,
        sn.created_at, sn.updated_at,
        u.name as author_name, u.avatar_url as author_avatar
      FROM shared_notes sn
      JOIN users u ON sn.author_id = u.id
      WHERE sn.candidate_id = $1
      ORDER BY sn.created_at DESC`,
			[parseInt(candidate_id, 10)],
		);

		res.json({ success: true, notes: result.rows });
	} catch (err) {
		console.error('[collaboration] List notes error:', err.message);
		res.status(500).json({ error: 'Failed to fetch notes' });
	}
});

/**
 * POST /api/collaboration/notes
 */
router.post('/notes', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const { candidate_id, content, rating } = req.body;
		if (!candidate_id || !content || content.trim().length === 0) {
			return res.status(400).json({ error: 'candidate_id and content are required' });
		}
		if (rating !== undefined && (rating < 1 || rating > 5)) {
			return res.status(400).json({ error: 'rating must be 1-5' });
		}

		const result = await pool.query(
			`INSERT INTO shared_notes (candidate_id, author_id, content, rating)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
			[parseInt(candidate_id, 10), req.user.id, content.trim(), rating || null],
		);
		const note = result.rows[0];
		note.author_name = req.user.name;
		note.author_avatar = req.user.avatar_url;

		res.status(201).json({ success: true, note });
	} catch (err) {
		console.error('[collaboration] Create note error:', err.message);
		res.status(500).json({ error: 'Failed to create note' });
	}
});

/**
 * PUT /api/collaboration/notes/:id
 */
router.put('/notes/:id', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const noteId = parseInt(req.params.id, 10);
		const { content, rating } = req.body;

		const check = await pool.query(`SELECT author_id FROM shared_notes WHERE id = $1`, [noteId]);
		if (check.rows.length === 0) {
			return res.status(404).json({ error: 'Note not found' });
		}
		if (check.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'You can only edit your own notes' });
		}
		if (rating !== undefined && (rating < 1 || rating > 5)) {
			return res.status(400).json({ error: 'rating must be 1-5' });
		}

		const result = await pool.query(
			`UPDATE shared_notes
       SET content = COALESCE($1, content),
           rating = COALESCE($2, rating),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
			[content !== undefined ? content.trim() : null, rating !== undefined ? rating : null, noteId],
		);

		res.json({ success: true, note: result.rows[0] });
	} catch (err) {
		console.error('[collaboration] Update note error:', err.message);
		res.status(500).json({ error: 'Failed to update note' });
	}
});

/**
 * DELETE /api/collaboration/notes/:id
 */
router.delete('/notes/:id', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const noteId = parseInt(req.params.id, 10);

		const check = await pool.query(`SELECT author_id FROM shared_notes WHERE id = $1`, [noteId]);
		if (check.rows.length === 0) {
			return res.status(404).json({ error: 'Note not found' });
		}
		if (check.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'You can only delete your own notes' });
		}

		await pool.query(`DELETE FROM shared_notes WHERE id = $1`, [noteId]);

		res.json({ success: true, deleted: true });
	} catch (err) {
		console.error('[collaboration] Delete note error:', err.message);
		res.status(500).json({ error: 'Failed to delete note' });
	}
});

// ─── Activity Feed ────────────────────────────────────────────────────────

/**
 * GET /api/collaboration/activity/:jobId
 * Activity feed for a job, ordered by created_at DESC.
 */
router.get('/activity/:jobId', authMiddleware, requireHiringTeam, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		const { limit = 50, offset = 0 } = req.query;

		// Verify job access (recruiters only see their company's jobs)
		const jobCheck = await pool.query(`SELECT company_id FROM jobs WHERE id = $1`, [jobId]);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== jobCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied for this job' });
		}

		const result = await pool.query(
			`SELECT
        ha.id, ha.job_id, ha.user_id, ha.action_type, ha.description, ha.metadata, ha.created_at,
        u.name as user_name, u.avatar_url as user_avatar
      FROM hiring_activity ha
      JOIN users u ON ha.user_id = u.id
      WHERE ha.job_id = $1
      ORDER BY ha.created_at DESC
      LIMIT $2 OFFSET $3`,
			[jobId, parseInt(limit, 10), parseInt(offset, 10)],
		);

		const countResult = await pool.query(`SELECT COUNT(*) FROM hiring_activity WHERE job_id = $1`, [
			jobId,
		]);

		res.json({
			success: true,
			activities: result.rows,
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (err) {
		console.error('[collaboration] Activity feed error:', err.message);
		res.status(500).json({ error: 'Failed to fetch activity feed' });
	}
});

module.exports = router;
