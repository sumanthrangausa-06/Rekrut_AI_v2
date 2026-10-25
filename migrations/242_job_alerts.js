/**
 * Migration 242: job_alerts table (#528)
 *
 * Stores candidate job alert subscriptions. Frontend JobAlertsTab
 * (client/src/pages/candidate/profile.tsx) already calls the CRUD
 * endpoints; this table backs them.
 */
module.exports = {
	name: '242_job_alerts',
	async up(client) {
		await client.query(`
      CREATE TABLE IF NOT EXISTS job_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        keywords TEXT NOT NULL,
        location TEXT,
        job_type VARCHAR(50),
        salary_min INTEGER,
        frequency VARCHAR(20) DEFAULT 'daily',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_job_alerts_user
        ON job_alerts(user_id) WHERE is_active = true;
    `);
	},
	async down(client) {
		await client.query(`DROP TABLE IF EXISTS job_alerts;`);
	},
};
