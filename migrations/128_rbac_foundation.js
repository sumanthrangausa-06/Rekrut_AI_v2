/**
 * Migration 128: RBAC Foundation — roles, permissions, junction tables, seed data
 * GitHub Issue #138 — P0 launch blocker
 */

module.exports = {
	name: '128_rbac_foundation',
	up: async (client) => {
		// ─── 1. roles table ───────────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS roles (
				id SERIAL PRIMARY KEY,
				name VARCHAR(50) UNIQUE NOT NULL,
				description TEXT,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);

		// ─── 2. permissions table ─────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS permissions (
				id SERIAL PRIMARY KEY,
				name VARCHAR(100) UNIQUE NOT NULL,
				resource VARCHAR(50) NOT NULL,
				action VARCHAR(50) NOT NULL,
				description TEXT
			)
		`);

		// ─── 3. role_permissions junction ─────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS role_permissions (
				role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
				PRIMARY KEY (role_id, permission_id)
			)
		`);

		// ─── 4. user_roles junction (scoped to company) ───────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS user_roles (
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
				assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
				assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				PRIMARY KEY (user_id, role_id, company_id)
			)
		`);

		// ─── 5. Indexes on foreign keys ───────────────────────────────────────
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
			CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
			CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
			CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
			CREATE INDEX IF NOT EXISTS idx_user_roles_company_id ON user_roles(company_id);
			CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by ON user_roles(assigned_by);
		`);

		// ─── 6. Seed: 6 core roles ────────────────────────────────────────────
		const roles = [
			{ name: 'owner', description: 'Full access including billing and company ownership' },
			{ name: 'admin', description: 'Manage members, jobs, and settings (no billing)' },
			{ name: 'recruiter', description: 'Manage own jobs and candidates' },
			{ name: 'hiring_manager', description: 'View and score assigned candidates only' },
			{ name: 'interviewer', description: 'Access only their own scheduled interviews' },
			{ name: 'viewer', description: 'Read-only analytics access' },
		];

		for (const role of roles) {
			await client.query(
				`INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
				[role.name, role.description],
			);
		}

		// ─── 7. Seed: core permissions ────────────────────────────────────────
		const permissions = [
			// Billing
			{ name: 'billing:manage', resource: 'billing', action: 'manage', description: 'Manage subscriptions, invoices, and payment methods' },
			{ name: 'billing:read', resource: 'billing', action: 'read', description: 'View billing information' },
			// Company
			{ name: 'company:manage', resource: 'company', action: 'manage', description: 'Update company profile and settings' },
			{ name: 'company:read', resource: 'company', action: 'read', description: 'View company profile' },
			// Members / Team
			{ name: 'members:manage', resource: 'members', action: 'manage', description: 'Invite, remove, and manage team members' },
			{ name: 'members:read', resource: 'members', action: 'read', description: 'View team members' },
			// Jobs
			{ name: 'jobs:create', resource: 'jobs', action: 'create', description: 'Create new job postings' },
			{ name: 'jobs:read', resource: 'jobs', action: 'read', description: 'View job postings' },
			{ name: 'jobs:update', resource: 'jobs', action: 'update', description: 'Edit job postings' },
			{ name: 'jobs:delete', resource: 'jobs', action: 'delete', description: 'Delete job postings' },
			// Candidates
			{ name: 'candidates:read', resource: 'candidates', action: 'read', description: 'View candidate profiles and applications' },
			{ name: 'candidates:score', resource: 'candidates', action: 'score', description: 'Score and evaluate candidates' },
			{ name: 'candidates:manage', resource: 'candidates', action: 'manage', description: 'Full candidate management including offers' },
			// Interviews
			{ name: 'interviews:read', resource: 'interviews', action: 'read', description: 'View interviews and feedback' },
			{ name: 'interviews:schedule', resource: 'interviews', action: 'schedule', description: 'Schedule and manage interviews' },
			{ name: 'interviews:conduct', resource: 'interviews', action: 'conduct', description: 'Conduct interviews and submit scorecards' },
			// Analytics
			{ name: 'analytics:read', resource: 'analytics', action: 'read', description: 'View analytics dashboards and reports' },
			// Settings
			{ name: 'settings:manage', resource: 'settings', action: 'manage', description: 'Manage application settings and integrations' },
			{ name: 'settings:read', resource: 'settings', action: 'read', description: 'View application settings' },
			// Compliance / Audit
			{ name: 'compliance:read', resource: 'compliance', action: 'read', description: 'View compliance reports and audit logs' },
			{ name: 'compliance:manage', resource: 'compliance', action: 'manage', description: 'Manage compliance settings and data retention' },
		];

		for (const perm of permissions) {
			await client.query(
				`INSERT INTO permissions (name, resource, action, description)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (name) DO NOTHING`,
				[perm.name, perm.resource, perm.action, perm.description],
			);
		}

		// ─── 8. Map permissions to roles ──────────────────────────────────────
		// Helper: build a map of role_name -> role_id
		const roleRes = await client.query(`SELECT id, name FROM roles WHERE name = ANY($1)`, [
			roles.map((r) => r.name),
		]);
		const roleIdByName = {};
		for (const row of roleRes.rows) {
			roleIdByName[row.name] = row.id;
		}

		// Helper: build a map of perm_name -> perm_id
		const permRes = await client.query(`SELECT id, name FROM permissions`);
		const permIdByName = {};
		for (const row of permRes.rows) {
			permIdByName[row.name] = row.id;
		}

		const rolePermissionMap = {
			owner: [
				'billing:manage', 'billing:read',
				'company:manage', 'company:read',
				'members:manage', 'members:read',
				'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
				'candidates:read', 'candidates:score', 'candidates:manage',
				'interviews:read', 'interviews:schedule', 'interviews:conduct',
				'analytics:read',
				'settings:manage', 'settings:read',
				'compliance:read', 'compliance:manage',
			],
			admin: [
				'company:manage', 'company:read',
				'members:manage', 'members:read',
				'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
				'candidates:read', 'candidates:score', 'candidates:manage',
				'interviews:read', 'interviews:schedule', 'interviews:conduct',
				'analytics:read',
				'settings:manage', 'settings:read',
				'compliance:read',
			],
			recruiter: [
				'company:read',
				'members:read',
				'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
				'candidates:read', 'candidates:score', 'candidates:manage',
				'interviews:read', 'interviews:schedule', 'interviews:conduct',
				'analytics:read',
				'settings:read',
			],
			hiring_manager: [
				'company:read',
				'jobs:read',
				'candidates:read', 'candidates:score',
				'interviews:read',
			],
			interviewer: [
				'interviews:read', 'interviews:conduct',
			],
			viewer: [
				'company:read',
				'jobs:read',
				'candidates:read',
				'interviews:read',
				'analytics:read',
			],
		};

		for (const [roleName, permNames] of Object.entries(rolePermissionMap)) {
			const roleId = roleIdByName[roleName];
			if (!roleId) continue;
			for (const permName of permNames) {
				const permId = permIdByName[permName];
				if (!permId) continue;
				await client.query(
					`INSERT INTO role_permissions (role_id, permission_id)
					 VALUES ($1, $2)
					 ON CONFLICT (role_id, permission_id) DO NOTHING`,
					[roleId, permId],
				);
			}
		}

		console.log('[migration:128] RBAC foundation tables, indexes, and seed data created');
	},
};
