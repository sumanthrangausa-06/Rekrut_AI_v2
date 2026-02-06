module.exports = {
  name: '018_extend_onboarding_documents',
  async up(client) {
    // Add signed_at column to track e-signature timestamps
    await client.query(`
      ALTER TABLE onboarding_documents ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP
    `);

    // Add company_id column for easier recruiter queries
    await client.query(`
      ALTER TABLE onboarding_documents ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    `);

    // Add content_summary for AI-generated documents
    await client.query(`
      ALTER TABLE onboarding_documents ADD COLUMN IF NOT EXISTS content_summary TEXT
    `);

    // Create index for efficient recruiter queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_company ON onboarding_documents(company_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_signed_at ON onboarding_documents(signed_at);
    `);

    console.log('Extended onboarding_documents table with signed_at, company_id, and content_summary columns');
  }
};
