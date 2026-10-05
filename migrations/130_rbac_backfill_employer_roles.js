/**
 * Migration 130: RBAC Backfill — assign roles to existing employer users
 *
 * Problem: RBAC foundation (migration 128) created roles/permissions tables,
 * but existing employer users have no entries in user_roles. This causes
 * 403 PERMISSION_DENIED on all recruiter endpoints (e.g., POST /recruiter/jobs).
 *
 * Fix: Backfill user_roles for all existing users based on their users.role:
 *   - users.role = 'employer' + owns a company → 'owner' role
 *   - users.role = 'employer' (no company or not owner) → 'recruiter' role
 *   - users.role = 'admin' → 'admin' role
 *
 * Uses ON CONFLICT DO NOTHING for idempotency.
 */

module.exports = {
	name: '130_rbac_backfill_employer_roles',
	up: async (client) => {
		// Backfill: employers who own a company → 'owner' role
		await client.query(`
			INSERT INTO user_roles (user_id, role_id, company_id, assigned_by)
			SELECT u.id, r.id, u.company_id, u.id
			FROM users u
			CROSS JOIN roles r
			JOIN companies c ON c.id = u.company_id AND c.owner_id = u.id
			WHERE u.role = 'employer'
			  AND r.name = 'owner'
			  AND u.company_id IS NOT NULL
			ON CONFLICT DO NOTHING
		`);

		// Backfill: employers without owned company → 'recruiter' role
		await client.query(`
			INSERT INTO user_roles (user_id, role_id, company_id, assigned_by)
			SELECT u.id, r.id, u.company_id, u.id
			FROM users u
			CROSS JOIN roles r
			WHERE u.role = 'employer'
			  AND r.name = 'recruiter'
			  AND NOT EXISTS (
			    SELECT 1 FROM user_roles ur
			    WHERE ur.user_id = u.id
			  )
			ON CONFLICT DO NOTHING
		`);

		// Backfill: admin users → 'admin' role
		await client.query(`
			INSERT INTO user_roles (user_id, role_id, assigned_by)
			SELECT u.id, r.id, u.id
			FROM users u
			CROSS JOIN roles r
			WHERE u.role = 'admin'
			  AND r.name = 'admin'
			  AND NOT EXISTS (
			    SELECT 1 FROM user_roles ur
			    WHERE ur.user_id = u.id
			  )
			ON CONFLICT DO NOTHING
		`);
	},
	down: async (client) => {
		// Remove backfilled roles (only those created by this migration)
		// Note: This is best-effort; manually assigned roles after migration won't be removed
		await client.query(`
			DELETE FROM user_roles
			WHERE assigned_by IN (
				SELECT id FROM users WHERE role IN ('employer', 'admin')
			)
			AND user_id = assigned_by
		`);
	},
};
