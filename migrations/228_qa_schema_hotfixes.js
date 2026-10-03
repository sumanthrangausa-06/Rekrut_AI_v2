/**
 * Migration 228: QA schema hotfixes (local + staging Neon)
 * - career_diagnoses.diagnosis_data (#77) when table already existed from 136
 * - users.subscription_plan / subscription_status for billing
 */

module.exports = {
	name: '228_qa_schema_hotfixes',
	up: async (client) => {
		await client.query(`
			ALTER TABLE career_diagnoses
			ADD COLUMN IF NOT EXISTS diagnosis_data JSONB DEFAULT '{}'::jsonb
		`);

		await client.query(`
			ALTER TABLE users
			ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50),
			ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50)
		`);

		console.log('[migration:228] QA schema hotfixes applied');
	},
};
