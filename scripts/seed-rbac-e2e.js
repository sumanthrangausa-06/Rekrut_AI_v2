const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres@localhost/rekrut_e2e_phased' });

(async () => {
	try {
		// Get recruiter user ID
		const userRes = await pool.query(
			"SELECT id FROM users WHERE email = 'e2e-recruiter@rekrutai.test'",
		);
		if (userRes.rows.length === 0) {
			console.log('Recruiter user not found');
			await pool.end();
			return;
		}
		const recruiterUserId = userRes.rows[0].id;

		// Get recruiter role ID
		const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'recruiter'");
		const recruiterRoleId = roleRes.rows[0].id;

		// Check if already assigned
		const existing = await pool.query(
			'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2',
			[recruiterUserId, recruiterRoleId],
		);
		if (existing.rows.length === 0) {
			await pool.query(
				'INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)',
				[recruiterUserId, recruiterRoleId, 1],
			);
			console.log('Assigned recruiter role to user', recruiterUserId);
		} else {
			console.log('User already has recruiter role');
		}

		// Get all permissions and assign to recruiter role
		const perms = await pool.query('SELECT id FROM permissions');
		let assigned = 0;
		for (const perm of perms.rows) {
			const ex = await pool.query(
				'SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
				[recruiterRoleId, perm.id],
			);
			if (ex.rows.length === 0) {
				await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [
					recruiterRoleId,
					perm.id,
				]);
				assigned++;
			}
		}
		console.log(
			'Assigned',
			assigned,
			'new permissions to recruiter role (total:',
			perms.rows.length,
			')',
		);
	} catch (err) {
		console.error('Error:', err.message);
	} finally {
		await pool.end();
	}
})();
