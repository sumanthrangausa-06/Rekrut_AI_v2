const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();

// Helper: verify department belongs to user's company
async function verifyDepartmentCompany(departmentId, companyId) {
	const result = await pool.query(
		'SELECT id FROM departments WHERE id = $1 AND company_id = $2',
		[departmentId, companyId],
	);
	return result.rows[0] || null;
}

// GET /api/departments — list all departments for the user's company
router.get('/', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const result = await pool.query(
			`SELECT d.*,
				(SELECT COUNT(*) FROM department_members dm WHERE dm.department_id = d.id) as member_count,
				(SELECT COUNT(*) FROM departments sub WHERE sub.parent_department_id = d.id) as sub_department_count
			 FROM departments d
			 WHERE d.company_id = $1
			 ORDER BY d.name`,
			[req.user.company_id],
		);
		res.json({ departments: result.rows });
	} catch (err) {
		console.error('List departments error:', err);
		res.status(500).json({ error: 'Failed to fetch departments' });
	}
});

// POST /api/departments — create a new department
router.post('/', authMiddleware, requirePermission('company:manage'), async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const { name, description, parent_department_id } = req.body;
		if (!name || !name.trim()) {
			return res.status(400).json({ error: 'Department name is required' });
		}

		// Validate parent department belongs to same company
		if (parent_department_id) {
			const parent = await verifyDepartmentCompany(parent_department_id, req.user.company_id);
			if (!parent) {
				return res.status(403).json({
					error: 'Parent department does not belong to your company',
					code: 'INVALID_PARENT',
				});
			}
		}

		const result = await pool.query(
			`INSERT INTO departments (company_id, name, description, parent_department_id)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
			[req.user.company_id, name.trim(), description || null, parent_department_id || null],
		);
		res.status(201).json({ success: true, department: result.rows[0] });
	} catch (err) {
		console.error('Create department error:', err);
		res.status(500).json({ error: 'Failed to create department' });
	}
});

// GET /api/departments/:id — get department details with member count
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const deptId = parseInt(req.params.id, 10);
		if (Number.isNaN(deptId)) {
			return res.status(400).json({ error: 'Invalid department ID' });
		}

		const result = await pool.query(
			`SELECT d.*,
				(SELECT COUNT(*) FROM department_members dm WHERE dm.department_id = d.id) as member_count,
				(SELECT COUNT(*) FROM departments sub WHERE sub.parent_department_id = d.id) as sub_department_count
			 FROM departments d
			 WHERE d.id = $1 AND d.company_id = $2`,
			[deptId, req.user.company_id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Department not found', code: 'DEPARTMENT_NOT_FOUND' });
		}

		res.json({ department: result.rows[0] });
	} catch (err) {
		console.error('Get department error:', err);
		res.status(500).json({ error: 'Failed to fetch department' });
	}
});

// PATCH /api/departments/:id — update department
router.patch('/:id', authMiddleware, requirePermission('company:manage'), async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const deptId = parseInt(req.params.id, 10);
		if (Number.isNaN(deptId)) {
			return res.status(400).json({ error: 'Invalid department ID' });
		}

		const { name, description, parent_department_id } = req.body;

		// Verify department belongs to company
		const existing = await pool.query(
			'SELECT id FROM departments WHERE id = $1 AND company_id = $2',
			[deptId, req.user.company_id],
		);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Department not found', code: 'DEPARTMENT_NOT_FOUND' });
		}

		// Prevent self-referencing
		if (parent_department_id && parseInt(parent_department_id, 10) === deptId) {
			return res.status(400).json({
				error: 'A department cannot be its own parent',
				code: 'SELF_REFERENCE',
			});
		}

		// Validate parent department belongs to same company
		if (parent_department_id) {
			const parent = await verifyDepartmentCompany(parent_department_id, req.user.company_id);
			if (!parent) {
				return res.status(403).json({
					error: 'Parent department does not belong to your company',
					code: 'INVALID_PARENT',
				});
			}
		}

		const result = await pool.query(
			`UPDATE departments SET
				name = COALESCE($1, name),
				description = COALESCE($2, description),
				parent_department_id = COALESCE($3, parent_department_id),
				updated_at = NOW()
			 WHERE id = $4 AND company_id = $5
			 RETURNING *`,
			[
				name ? name.trim() : null,
				description !== undefined ? description || null : null,
				parent_department_id !== undefined ? parent_department_id || null : null,
				deptId,
				req.user.company_id,
			],
		);

		res.json({ success: true, department: result.rows[0] });
	} catch (err) {
		console.error('Update department error:', err);
		res.status(500).json({ error: 'Failed to update department' });
	}
});

// DELETE /api/departments/:id — delete department
router.delete('/:id', authMiddleware, requirePermission('company:manage'), async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const deptId = parseInt(req.params.id, 10);
		if (Number.isNaN(deptId)) {
			return res.status(400).json({ error: 'Invalid department ID' });
		}

		// Verify department belongs to company
		const existing = await pool.query(
			'SELECT id FROM departments WHERE id = $1 AND company_id = $2',
			[deptId, req.user.company_id],
		);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Department not found', code: 'DEPARTMENT_NOT_FOUND' });
		}

		// Check for sub-departments
		const subDepts = await pool.query(
			'SELECT id FROM departments WHERE parent_department_id = $1',
			[deptId],
		);
		if (subDepts.rows.length > 0) {
			return res.status(400).json({
				error: 'Cannot delete department with sub-departments',
				code: 'HAS_SUBDEPARTMENTS',
			});
		}

		// Check for assigned jobs
		const jobs = await pool.query('SELECT id FROM jobs WHERE department_id = $1', [deptId]);
		if (jobs.rows.length > 0) {
			return res.status(400).json({
				error: 'Cannot delete department with assigned jobs',
				code: 'HAS_JOBS',
			});
		}

		await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
		res.json({ success: true });
	} catch (err) {
		console.error('Delete department error:', err);
		res.status(500).json({ error: 'Failed to delete department' });
	}
});

// POST /api/departments/:id/members — assign a user to department
router.post(
	'/:id/members',
	authMiddleware,
	requirePermission('members:manage'),
	async (req, res) => {
		try {
			if (!req.user.company_id) {
				return res.status(400).json({ error: 'No company associated with this account' });
			}
			const deptId = parseInt(req.params.id, 10);
			if (Number.isNaN(deptId)) {
				return res.status(400).json({ error: 'Invalid department ID' });
			}

			// Verify department belongs to company
			const dept = await verifyDepartmentCompany(deptId, req.user.company_id);
			if (!dept) {
				return res.status(404).json({
					error: 'Department not found',
					code: 'DEPARTMENT_NOT_FOUND',
				});
			}

			const { user_id, is_manager = false } = req.body;
			if (!user_id) {
				return res.status(400).json({ error: 'user_id is required' });
			}

			// Verify user belongs to same company
			const userCheck = await pool.query(
				'SELECT id FROM users WHERE id = $1 AND company_id = $2',
				[user_id, req.user.company_id],
			);
			if (userCheck.rows.length === 0) {
				return res.status(403).json({
					error: 'User does not belong to your company',
					code: 'USER_NOT_IN_COMPANY',
				});
			}

			await pool.query(
				`INSERT INTO department_members (department_id, user_id, is_manager)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (department_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager`,
				[deptId, user_id, is_manager],
			);

			res.json({ success: true });
		} catch (err) {
			console.error('Add department member error:', err);
			res.status(500).json({ error: 'Failed to add department member' });
		}
	},
);

// DELETE /api/departments/:id/members/:userId — remove user from department
router.delete(
	'/:id/members/:userId',
	authMiddleware,
	requirePermission('members:manage'),
	async (req, res) => {
		try {
			if (!req.user.company_id) {
				return res.status(400).json({ error: 'No company associated with this account' });
			}
			const deptId = parseInt(req.params.id, 10);
			const userId = parseInt(req.params.userId, 10);
			if (Number.isNaN(deptId) || Number.isNaN(userId)) {
				return res.status(400).json({ error: 'Invalid department or user ID' });
			}

			// Verify department belongs to company
			const dept = await verifyDepartmentCompany(deptId, req.user.company_id);
			if (!dept) {
				return res.status(404).json({
					error: 'Department not found',
					code: 'DEPARTMENT_NOT_FOUND',
				});
			}

			await pool.query(
				'DELETE FROM department_members WHERE department_id = $1 AND user_id = $2',
				[deptId, userId],
			);

			res.json({ success: true });
		} catch (err) {
			console.error('Remove department member error:', err);
			res.status(500).json({ error: 'Failed to remove department member' });
		}
	},
);

// GET /api/departments/:id/members — list members of a department
router.get('/:id/members', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}
		const deptId = parseInt(req.params.id, 10);
		if (Number.isNaN(deptId)) {
			return res.status(400).json({ error: 'Invalid department ID' });
		}

		// Verify department belongs to company
		const dept = await verifyDepartmentCompany(deptId, req.user.company_id);
		if (!dept) {
			return res.status(404).json({ error: 'Department not found', code: 'DEPARTMENT_NOT_FOUND' });
		}

		const result = await pool.query(
			`SELECT u.id, u.email, u.name, u.role, dm.is_manager, dm.created_at as joined_at
			 FROM department_members dm
			 JOIN users u ON dm.user_id = u.id
			 WHERE dm.department_id = $1
			 ORDER BY dm.is_manager DESC, u.name`,
			[deptId],
		);

		res.json({ members: result.rows });
	} catch (err) {
		console.error('List department members error:', err);
		res.status(500).json({ error: 'Failed to fetch department members' });
	}
});

module.exports = router;
