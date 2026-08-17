/**
 * Migration 224: Department hierarchy — departments, department_members, job scoping
 * GitHub Issue #139
 */

module.exports = {
	name: '224_department_hierarchy',
	up: async (client) => {
		// ─── 1. departments table ───────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS departments (
				id SERIAL PRIMARY KEY,
				company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
				name VARCHAR(255) NOT NULL,
				description TEXT,
				parent_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);

		// ─── 2. department_members junction ─────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS department_members (
				department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				is_manager BOOLEAN DEFAULT false,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				PRIMARY KEY (department_id, user_id)
			)
		`);

		// ─── 3. Add department_id to jobs ───────────────────────────────────
		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL
		`);

		// ─── 4. Indexes on foreign keys ─────────────────────────────────────
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_departments_company_id ON departments(company_id);
			CREATE INDEX IF NOT EXISTS idx_departments_parent_id ON departments(parent_department_id);
			CREATE INDEX IF NOT EXISTS idx_department_members_department_id ON department_members(department_id);
			CREATE INDEX IF NOT EXISTS idx_department_members_user_id ON department_members(user_id);
			CREATE INDEX IF NOT EXISTS idx_jobs_department_id ON jobs(department_id);
		`);

		console.log('[migration:224] Department hierarchy tables and indexes created');
	},
};
