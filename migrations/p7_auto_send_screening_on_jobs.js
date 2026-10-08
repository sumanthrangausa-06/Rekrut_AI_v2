module.exports = {
	name: 'p7_auto_send_screening_on_jobs',
	description: 'Add auto-send screening settings to jobs table (per #307)',
	async up(client) {
		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS auto_send_on_apply BOOLEAN DEFAULT false,
			ADD COLUMN IF NOT EXISTS auto_send_min_score INTEGER DEFAULT 70
		`);
		// Backfill from existing template-level settings (if any)
		await client.query(`
			UPDATE jobs j
			SET auto_send_on_apply = t.auto_send_on_apply
			FROM screening_templates t
			WHERE t.job_id = j.id AND t.auto_send_on_apply = true
		`);
	},
	async down(client) {
		await client.query(`
			ALTER TABLE jobs
			DROP COLUMN IF EXISTS auto_send_on_apply,
			DROP COLUMN IF EXISTS auto_send_min_score
		`);
	},
};
