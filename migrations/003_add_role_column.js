module.exports = {
  name: '003_add_role_column',
  up: async (client) => {
    // Add role column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'candidate'
    `);

    // Add company_name column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)
    `);
  }
};
