module.exports = {
  name: '020_w4_filing_status',
  async up(client) {
    // Add W-4 filing status to candidate onboarding data
    await client.query(`
      ALTER TABLE candidate_onboarding_data
      ADD COLUMN IF NOT EXISTS w4_filing_status VARCHAR(50) DEFAULT 'single'
    `);

    console.log('Added w4_filing_status column to candidate_onboarding_data');
  }
};
