/**
 * Migration 225: Career Diagnosis — 360° skills assessment
 * GitHub Issue #77
 */

module.exports = {
	name: '225_career_diagnosis',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS career_diagnoses (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				diagnosis_data JSONB NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_career_diagnoses_user_id ON career_diagnoses(user_id)
		`);

		console.log('[migration:225] career_diagnoses table and indexes created');

		await client.query(`
			ALTER TABLE career_diagnoses
			ADD COLUMN IF NOT EXISTS diagnosis_data JSONB DEFAULT '{}'::jsonb
		`);
	},
};
