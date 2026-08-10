// Audit Log Routes — Issue #156
const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

/**
 * Helper: Insert an audit log entry.
 * Used by other route files (e.g. company.js) to log events.
 */
async function insertAuditLog({ company_id, actor_id, target_id, action, reason, metadata = {} }) {
	await pool.query(
		`INSERT INTO audit_logs (company_id, actor_id, target_id, action, reason, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
		[company_id, actor_id, target_id || null, action, reason || null, JSON.stringify(metadata)],
	);
}

/**
 * GET /api/company/audit-log
 * Returns audit log entries for the current user's company.
 * Owner-only access.
 */
router.get('/audit-log', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}

		// Verify the user is the company owner
		const companyResult = await pool.query('SELECT owner_id FROM companies WHERE id = $1', [
			req.user.company_id,
		]);
		if (companyResult.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}
		if (companyResult.rows[0].owner_id !== req.user.id) {
			return res.status(403).json({ error: 'Only the company owner can view the audit log' });
		}

		const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
		const offset = parseInt(req.query.offset, 10) || 0;

		const result = await pool.query(
			`SELECT
        al.id,
        al.company_id,
        al.actor_id,
        actor.name as actor_name,
        actor.email as actor_email,
        al.target_id,
        target.name as target_name,
        target.email as target_email,
        al.action,
        al.reason,
        al.metadata,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users actor ON al.actor_id = actor.id
      LEFT JOIN users target ON al.target_id = target.id
      WHERE al.company_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2 OFFSET $3`,
			[req.user.company_id, limit, offset],
		);

		const countResult = await pool.query(
			'SELECT COUNT(*) as total FROM audit_logs WHERE company_id = $1',
			[req.user.company_id],
		);

		res.json({
			success: true,
			logs: result.rows,
			total: parseInt(countResult.rows[0].total, 10),
			limit,
			offset,
		});
	} catch (err) {
		console.error('Get audit log error:', err);
		res.status(500).json({ error: 'Failed to fetch audit log' });
	}
});

module.exports = { router, insertAuditLog };
