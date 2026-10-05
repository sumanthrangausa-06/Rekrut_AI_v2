/**
 * Migration: Add topics to screening_templates for conversational screening.
 * Topics are coverage areas (e.g., ["React experience", "Leadership"]) that the
 * AI uses as a checklist, not fixed questions.
 */
module.exports = {
	name: 'p6_screening_template_topics',
	up: async (client) => {
		await client.query(`
      ALTER TABLE screening_templates
      ADD COLUMN IF NOT EXISTS topics JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS screening_mode VARCHAR(50) DEFAULT 'conversational'
    `);
	},
	down: async (client) => {
		await client.query(`
      ALTER TABLE screening_templates
      DROP COLUMN IF EXISTS topics,
      DROP COLUMN IF EXISTS screening_mode
    `);
	},
};
