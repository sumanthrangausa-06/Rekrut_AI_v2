module.exports = {
  name: '015_add_company_id_to_offers',
  async up(client) {
    // Add company_id column to offers table
    await client.query(`
      ALTER TABLE offers
      ADD COLUMN company_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    `);

    // Backfill company_id from job.company_id for existing offers
    await client.query(`
      UPDATE offers o
      SET company_id = j.company_id
      FROM jobs j
      WHERE o.job_id = j.id AND o.company_id IS NULL
    `);

    // Create index for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_offers_company ON offers(company_id)
    `);

    console.log('Added company_id to offers table and backfilled data');
  }
};
