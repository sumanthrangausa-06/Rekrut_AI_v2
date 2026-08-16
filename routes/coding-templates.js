// =============================================================================
// routes/coding-templates.js — Coding Template Library API (Issue #119)
// =============================================================================
//
// Endpoints:
//   GET  /api/coding-templates            — List templates (filters: role_type, difficulty, is_custom)
//   GET  /api/coding-templates/:id        — Get template with test cases
//   POST /api/coding-templates            — Create custom template (recruiter only)
//   PUT  /api/coding-templates/:id        — Update template (recruiter only)
//   DELETE /api/coding-templates/:id      — Soft delete (recruiter only)
//
// Security:
//   - authMiddleware on all routes
//   - requireRole for recruiter/admin on write operations
//   - Hidden test cases never exposed to candidates
//
// =============================================================================

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogService');

const router = express.Router();

// Recruiter roles
const RECRUITER_ROLES = ['recruiter', 'hiring_manager', 'employer', 'admin'];

function isRecruiter(user) {
	return RECRUITER_ROLES.includes(user?.role);
}

// =============================================================================
// GET /api/coding-templates
// List templates with optional filters
// =============================================================================
router.get('/', authMiddleware, async (req, res) => {
	try {
		const { role_type, difficulty, is_custom, search, limit = 50, offset = 0 } = req.query;

		const conditions = ['deleted_at IS NULL'];
		const params = [];
		let paramIdx = 1;

		if (role_type) {
			conditions.push(`role_type = $${paramIdx++}`);
			params.push(role_type);
		}
		if (difficulty) {
			conditions.push(`difficulty = $${paramIdx++}`);
			params.push(difficulty);
		}
		if (is_custom !== undefined) {
			conditions.push(`is_custom = $${paramIdx++}`);
			params.push(is_custom === 'true');
		}
		if (search) {
			conditions.push(`(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
			params.push(`%${search}%`);
			paramIdx++;
		}

		// Candidates only see active templates; recruiters see all non-deleted
		if (!isRecruiter(req.user)) {
			conditions.push('is_active = true');
		}

		params.push(parseInt(limit, 10));
		params.push(parseInt(offset, 10));

		const result = await pool.query(
			`SELECT id, title, description, role_type, difficulty, language_support,
              time_limit_seconds, memory_limit_mb, is_custom, is_active,
              created_by, created_at, updated_at
       FROM coding_templates
       WHERE ${conditions.join(' AND ')}
       ORDER BY role_type ASC, difficulty ASC, created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
			params
		);

		// Count total
		const countResult = await pool.query(
			`SELECT COUNT(*) FROM coding_templates WHERE ${conditions.join(' AND ')}`,
			params.slice(0, -2)
		);

		res.json({
			templates: result.rows.map((t) => ({
				...t,
				language_support:
					typeof t.language_support === 'string'
						? JSON.parse(t.language_support)
						: t.language_support,
			})),
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (error) {
		console.error('[coding-templates] List error:', error);
		res.status(500).json({ error: 'Failed to list templates' });
	}
});

// =============================================================================
// GET /api/coding-templates/:id
// Get single template with test cases
// Candidates see only visible (non-hidden) test cases
// Recruiters see all test cases
// =============================================================================
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;

		const templateResult = await pool.query(
			`SELECT id, title, description, role_type, difficulty, language_support,
              time_limit_seconds, memory_limit_mb, starter_code,
              is_custom, is_active, created_by, created_at, updated_at
       FROM coding_templates
       WHERE id = $1 AND deleted_at IS NULL`,
			[id]
		);

		if (templateResult.rows.length === 0) {
			return res.status(404).json({ error: 'Template not found' });
		}

		const template = templateResult.rows[0];
		template.language_support =
			typeof template.language_support === 'string'
				? JSON.parse(template.language_support)
				: template.language_support;
		template.starter_code =
			typeof template.starter_code === 'string' && template.starter_code
				? JSON.parse(template.starter_code)
				: template.starter_code || {};

		// Test cases: candidates see only non-hidden
		const isRecruiterView = isRecruiter(req.user);
		const tcQuery = isRecruiterView
			? `SELECT id, name, description, stdin, expected_output, is_hidden, weight, order_index, created_at
           FROM coding_test_cases WHERE template_id = $1 ORDER BY order_index ASC`
			: `SELECT id, name, description, stdin, expected_output, is_hidden, weight, order_index, created_at
           FROM coding_test_cases WHERE template_id = $1 AND is_hidden = false ORDER BY order_index ASC`;

		const tcResult = await pool.query(tcQuery, [id]);

		res.json({
			template: {
				...template,
				test_cases: tcResult.rows,
			},
		});
	} catch (error) {
		console.error('[coding-templates] Get error:', error);
		res.status(500).json({ error: 'Failed to get template' });
	}
});

// =============================================================================
// POST /api/coding-templates
// Create a custom template (recruiter/admin only)
// =============================================================================
router.post(
	'/',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		const client = await pool.connect();
		try {
			const {
				title,
				description,
				role_type,
				difficulty,
				language_support,
				time_limit_seconds,
				memory_limit_mb,
				starter_code,
				test_cases,
			} = req.body;

			// Validation
			if (!title || !role_type || !difficulty) {
				return res.status(400).json({ error: 'title, role_type, and difficulty are required' });
			}
			const validRoles = ['frontend', 'backend', 'data', 'sql', 'algorithms'];
			const validDifficulties = ['easy', 'medium', 'hard'];
			if (!validRoles.includes(role_type)) {
				return res.status(400).json({ error: `role_type must be one of: ${validRoles.join(', ')}` });
			}
			if (!validDifficulties.includes(difficulty)) {
				return res.status(400).json({
					error: `difficulty must be one of: ${validDifficulties.join(', ')}`,
				});
			}

			await client.query('BEGIN');

			const templateResult = await client.query(
				`INSERT INTO coding_templates
           (title, description, role_type, difficulty, language_support,
            time_limit_seconds, memory_limit_mb, starter_code,
            created_by, is_custom, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
				[
					title,
					description || null,
					role_type,
					difficulty,
					JSON.stringify(language_support || []),
					time_limit_seconds || 15,
					memory_limit_mb || 512,
					starter_code ? JSON.stringify(starter_code) : '{}',
					req.user.id,
					true,
					true,
				]
			);
			const template = templateResult.rows[0];

			// Insert test cases if provided
			if (Array.isArray(test_cases) && test_cases.length > 0) {
				for (let i = 0; i < test_cases.length; i++) {
					const tc = test_cases[i];
					await client.query(
						`INSERT INTO coding_test_cases
               (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
						[
							template.id,
							tc.name || `Test ${i + 1}`,
							tc.description || null,
							tc.stdin || null,
							tc.expected_output || null,
							tc.is_hidden !== undefined ? tc.is_hidden : false,
							tc.weight || 10,
							i,
						]
					);
				}
			}

			await client.query('COMMIT');

			await AuditLogger.log({
				actionType: 'coding_template_created',
				userId: req.user.id,
				targetType: 'coding_template',
				targetId: template.id,
				metadata: { title, role_type, difficulty },
				req,
			});

			res.status(201).json({
				template: {
					...template,
					language_support:
						typeof template.language_support === 'string'
							? JSON.parse(template.language_support)
							: template.language_support,
				},
			});
		} catch (error) {
			await client.query('ROLLBACK');
			console.error('[coding-templates] Create error:', error);
			res.status(500).json({ error: 'Failed to create template' });
		} finally {
			client.release();
		}
	}
);

// =============================================================================
// PUT /api/coding-templates/:id
// Update a template (recruiter/admin only, or creator)
// =============================================================================
router.put(
	'/:id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		const client = await pool.connect();
		try {
			const { id } = req.params;
			const {
				title,
				description,
				role_type,
				difficulty,
				language_support,
				time_limit_seconds,
				memory_limit_mb,
				starter_code,
				is_active,
			} = req.body;

			// Verify ownership or admin
			const existing = await client.query(
				'SELECT * FROM coding_templates WHERE id = $1 AND deleted_at IS NULL',
				[id]
			);
			if (existing.rows.length === 0) {
				return res.status(404).json({ error: 'Template not found' });
			}
			const template = existing.rows[0];
			if (template.created_by !== req.user.id && req.user.role !== 'admin') {
				return res.status(403).json({ error: 'You can only edit your own templates' });
			}

			await client.query('BEGIN');

			const updateResult = await client.query(
				`UPDATE coding_templates SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           role_type = COALESCE($3, role_type),
           difficulty = COALESCE($4, difficulty),
           language_support = COALESCE($5, language_support),
           time_limit_seconds = COALESCE($6, time_limit_seconds),
           memory_limit_mb = COALESCE($7, memory_limit_mb),
           starter_code = COALESCE($8, starter_code),
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
         WHERE id = $10
         RETURNING *`,
				[
					title || null,
					description !== undefined ? description : null,
					role_type || null,
					difficulty || null,
					language_support ? JSON.stringify(language_support) : null,
					time_limit_seconds !== undefined ? time_limit_seconds : null,
					memory_limit_mb !== undefined ? memory_limit_mb : null,
					starter_code ? JSON.stringify(starter_code) : null,
					is_active !== undefined ? is_active : null,
					id,
				]
			);

			await client.query('COMMIT');

			const updated = updateResult.rows[0];
			updated.language_support =
				typeof updated.language_support === 'string'
					? JSON.parse(updated.language_support)
					: updated.language_support;

			res.json({ template: updated });
		} catch (error) {
			await client.query('ROLLBACK');
			console.error('[coding-templates] Update error:', error);
			res.status(500).json({ error: 'Failed to update template' });
		} finally {
			client.release();
		}
	}
);

// =============================================================================
// DELETE /api/coding-templates/:id
// Soft delete a template (recruiter/admin only, or creator)
// =============================================================================
router.delete(
	'/:id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const { id } = req.params;

			// Verify ownership or admin
			const existing = await pool.query(
				'SELECT * FROM coding_templates WHERE id = $1 AND deleted_at IS NULL',
				[id]
			);
			if (existing.rows.length === 0) {
				return res.status(404).json({ error: 'Template not found' });
			}
			const template = existing.rows[0];
			if (template.created_by !== req.user.id && req.user.role !== 'admin') {
				return res.status(403).json({ error: 'You can only delete your own templates' });
			}

			await pool.query('UPDATE coding_templates SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);

			await AuditLogger.log({
				actionType: 'coding_template_deleted',
				userId: req.user.id,
				targetType: 'coding_template',
				targetId: id,
				metadata: { title: template.title },
				req,
			});

			res.json({ deleted: true, templateId: id });
		} catch (error) {
			console.error('[coding-templates] Delete error:', error);
			res.status(500).json({ error: 'Failed to delete template' });
		}
	}
);

module.exports = router;
