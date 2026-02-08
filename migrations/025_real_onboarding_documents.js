module.exports = {
  name: '025_real_onboarding_documents',
  async up(client) {
    // I-9 attestation fields
    await client.query(`
      ALTER TABLE candidate_onboarding_data
      ADD COLUMN IF NOT EXISTS i9_citizenship_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS i9_alien_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS i9_admission_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS i9_passport_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS i9_country_of_issuance VARCHAR(100),
      ADD COLUMN IF NOT EXISTS i9_work_auth_expiry DATE,
      ADD COLUMN IF NOT EXISTS i9_document_title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_issuing_authority VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_document_number VARCHAR(255),
      ADD COLUMN IF NOT EXISTS i9_document_expiry DATE
    `);

    // Full W-4 fields (Steps 2-4)
    await client.query(`
      ALTER TABLE candidate_onboarding_data
      ADD COLUMN IF NOT EXISTS w4_multiple_jobs BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS w4_spouse_works BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS w4_num_dependents_under_17 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS w4_num_other_dependents INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS w4_other_income NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS w4_deductions NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS w4_extra_withholding NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS w4_exempt BOOLEAN DEFAULT false
    `);

    // AI-generated content fields
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS ai_generated_html TEXT,
      ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMP
    `);

    console.log('Added real onboarding document fields (I-9 attestation, full W-4, AI HTML)');
  }
};
