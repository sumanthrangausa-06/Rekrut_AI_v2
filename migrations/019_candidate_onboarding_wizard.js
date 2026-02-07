module.exports = {
  name: '019_candidate_onboarding_wizard',
  async up(client) {
    // Table to store candidate personal data collected during onboarding wizard
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_onboarding_data (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        checklist_id INTEGER REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
        legal_first_name VARCHAR(255),
        legal_middle_name VARCHAR(255),
        legal_last_name VARCHAR(255),
        date_of_birth DATE,
        ssn_encrypted TEXT,
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50),
        zip_code VARCHAR(20),
        phone VARCHAR(30),
        emergency_contact_name VARCHAR(255),
        emergency_contact_relationship VARCHAR(100),
        emergency_contact_phone VARCHAR(30),
        emergency_contact_email VARCHAR(255),
        bank_name VARCHAR(255),
        routing_number_encrypted TEXT,
        account_number_encrypted TEXT,
        account_type VARCHAR(20),
        current_step INTEGER DEFAULT 1,
        steps_completed JSONB DEFAULT '[]',
        wizard_status VARCHAR(50) DEFAULT 'in_progress',
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(candidate_id, checklist_id)
      )
    `);

    // Add signature fields to onboarding_documents
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS signature_data TEXT
    `);
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS signer_ip VARCHAR(50)
    `);
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS signer_user_agent TEXT
    `);
    await client.query(`
      ALTER TABLE onboarding_documents
      ADD COLUMN IF NOT EXISTS document_content JSONB
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_candidate_onboarding_data_candidate
      ON candidate_onboarding_data(candidate_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_candidate_onboarding_data_checklist
      ON candidate_onboarding_data(checklist_id)
    `);

    console.log('Candidate onboarding wizard tables created successfully');
  }
};
