/**
 * Migration 229: career_diagnoses.updated_at (#77 GET query)
 */

module.exports = {
	name: '229_career_diagnoses_updated_at',
	up: async (client) => {
		await client.query(`
			ALTER TABLE career_diagnoses
			ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		`);
		console.log('[migration:229] career_diagnoses.updated_at added');
	},
};
