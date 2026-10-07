// Migration: assessment score round-trip (#343 task 4)
// Records job assessment results on the application row: the composite score
// and the pass/fail mark. Nullable + additive: safe on the shared DB, no
// backfill needed (existing applications simply have no assessment result).

module.exports = {
	name: '233_assessment_score_roundtrip',
	description:
		'Add assessment_score + assessment_result to job_applications for the assessment score round-trip (#343 task 4)',
	async up(client) {
		await client.query(`
			ALTER TABLE job_applications
			ADD COLUMN IF NOT EXISTS assessment_score NUMERIC
		`);
		await client.query(`
			ALTER TABLE job_applications
			ADD COLUMN IF NOT EXISTS assessment_result VARCHAR(10)
		`);
	},
	async down(client) {
		await client.query(`
			ALTER TABLE job_applications
			DROP COLUMN IF EXISTS assessment_result
		`);
		await client.query(`
			ALTER TABLE job_applications
			DROP COLUMN IF EXISTS assessment_score
		`);
	},
};
