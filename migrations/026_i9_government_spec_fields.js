module.exports = {
  name: '026_i9_government_spec_fields',
  async up(client) {
    // Add fields required by official USCIS Form I-9 (Edition 01/20/2025)
    // that were missing from the original implementation
    await client.query(`
      ALTER TABLE candidate_onboarding_data
      ADD COLUMN IF NOT EXISTS i9_other_last_names VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_preparer_used BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS i9_preparer_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_preparer_address VARCHAR(500)
    `);

    console.log('Added I-9 government spec fields (other_last_names, email, preparer)');
  }
};
