// Migration 227: LinkedIn Profile Import Support (Issue #79)
// Adds columns for storing raw LinkedIn profile data and mapped title

module.exports = {
	name: '227_linkedin_profile_import',
	up: async (client) => {
		// Store raw LinkedIn API response for audit/debugging and re-import
		await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS linkedin_data JSONB DEFAULT NULL
    `);

		// Mapped title from LinkedIn headline (task #79 specifies users.title)
		await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS title TEXT DEFAULT NULL
    `);

		// Index for quickly finding users with LinkedIn data
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_linkedin_data
      ON users USING gin(linkedin_data)
      WHERE linkedin_data IS NOT NULL
    `);

		console.log('Migration 227: LinkedIn profile import columns added');
	},
};
