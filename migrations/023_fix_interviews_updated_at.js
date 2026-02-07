module.exports = {
  name: 'fix_interviews_updated_at',
  up: async (client) => {
    // Add missing updated_at column to interviews table
    // The /:id/respond endpoint uses SET updated_at = NOW() which fails without this column
    await client.query(`
      ALTER TABLE interviews
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
    `);

    // Backfill existing rows
    await client.query(`
      UPDATE interviews SET updated_at = COALESCE(completed_at, created_at) WHERE updated_at IS NULL
    `);

    console.log('Added updated_at column to interviews table');
  }
};
