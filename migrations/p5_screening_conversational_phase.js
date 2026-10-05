/**
 * Migration: Add current_phase to screening_sessions for conversational screening.
 * Tracks which phase of the screening interview we're in:
 * intro → background → experience → motivation → logistics → candidate_questions → close
 */
module.exports = {
	name: 'p5_screening_conversational_phase',
	up: async (client) => {
		await client.query(`
      ALTER TABLE screening_sessions
      ADD COLUMN IF NOT EXISTS current_phase VARCHAR(50) DEFAULT 'intro'
    `);
	},
	down: async (client) => {
		await client.query(`
      ALTER TABLE screening_sessions DROP COLUMN IF EXISTS current_phase
    `);
	},
};
