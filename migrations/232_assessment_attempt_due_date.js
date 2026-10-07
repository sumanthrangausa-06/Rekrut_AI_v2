// Migration: assessment attempt deadlines (#343 task 3)
// Adds an optional due_date to job_assessment_attempts so recruiters can set
// a deadline when assigning. Nullable + additive: safe on the shared DB, no
// backfill needed (existing attempts simply have no deadline).

module.exports = {
	name: '232_assessment_attempt_due_date',
	description: 'Add due_date to job_assessment_attempts for assignment deadlines (#343 task 3)',
	async up(client) {
		await client.query(`
			ALTER TABLE job_assessment_attempts
			ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ
		`);
	},
	async down(client) {
		await client.query(`
			ALTER TABLE job_assessment_attempts
			DROP COLUMN IF EXISTS due_date
		`);
	},
};
