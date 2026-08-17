module.exports = {
  up: async (pool) => {
    await pool.query(`
      ALTER TABLE candidate_profiles
        ADD COLUMN IF NOT EXISTS timezone_preference VARCHAR(100),
        ADD COLUMN IF NOT EXISTS travel_willingness VARCHAR(50),
        ADD COLUMN IF NOT EXISTS salary_currency VARCHAR(3) DEFAULT 'USD'
    `);
  },
  down: async (pool) => {
    await pool.query(`
      ALTER TABLE candidate_profiles
        DROP COLUMN IF EXISTS timezone_preference,
        DROP COLUMN IF EXISTS travel_willingness,
        DROP COLUMN IF EXISTS salary_currency
    `);
  }
};
