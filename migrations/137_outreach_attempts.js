module.exports = {
	name: '137_outreach_attempts',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS outreach_attempts (
				id SERIAL PRIMARY KEY,
				application_id INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				method VARCHAR(20) NOT NULL CHECK (method IN ('email', 'linkedin', 'phone', 'other')),
				message TEXT,
				status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'replied', 'follow_up', 'no_response')),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_outreach_attempts_application_id ON outreach_attempts(application_id)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_outreach_attempts_user_id ON outreach_attempts(user_id)
		`);
	},

	async down(client) {
		await client.query('DROP TABLE IF EXISTS outreach_attempts');
	},
};
