// Document Verification Migration - Phase 5
// Adds document processing, fraud detection, and verification scoring

module.exports = {
  name: '009_document_verification',
  up: async (client) => {
    // Document types enum
    const docTypes = ['resume', 'education_certificate', 'employment_letter', 'id_document', 'certification', 'reference_letter'];

    // Uploaded documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        document_type VARCHAR(50) NOT NULL,
        original_filename VARCHAR(255),
        file_url TEXT NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        uploaded_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,

        -- OCR extracted data
        extracted_text TEXT,
        extracted_data JSONB,

        -- Verification results
        authenticity_score INTEGER,
        fraud_flags JSONB DEFAULT '[]',
        verification_details JSONB,
        verified_by VARCHAR(50),
        verified_at TIMESTAMP,

        -- Metadata
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Document verification results
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_verifications (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES verification_documents(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        verification_type VARCHAR(50) NOT NULL,

        -- Fraud detection
        authenticity_score INTEGER CHECK (authenticity_score >= 0 AND authenticity_score <= 100),
        fraud_risk VARCHAR(50) DEFAULT 'low',
        fraud_indicators JSONB DEFAULT '[]',

        -- Consistency checks
        date_consistency_check BOOLEAN,
        name_consistency_check BOOLEAN,
        employer_consistency_check BOOLEAN,
        education_consistency_check BOOLEAN,
        inconsistencies_found JSONB DEFAULT '[]',

        -- Duplicate detection
        duplicate_hash VARCHAR(255),
        is_duplicate BOOLEAN DEFAULT false,
        duplicate_of INTEGER REFERENCES verification_documents(id),

        -- AI analysis
        ai_analysis JSONB,
        confidence_score INTEGER,

        verified_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Document access audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_access_logs (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES verification_documents(id) ON DELETE CASCADE,
        accessed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        access_type VARCHAR(50) NOT NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        purpose TEXT,
        accessed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Verified credentials tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS verified_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        credential_type VARCHAR(50) NOT NULL,
        credential_name VARCHAR(255),
        issuer VARCHAR(255),
        issue_date DATE,
        expiry_date DATE,
        verification_status VARCHAR(50) DEFAULT 'verified',
        document_id INTEGER REFERENCES verification_documents(id),
        verification_score INTEGER,
        verified_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, credential_type, credential_name, issuer)
      )
    `);

    // Document score contributions to OmniScore
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_score_impacts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES verification_documents(id) ON DELETE CASCADE,
        document_type VARCHAR(50),
        score_impact INTEGER NOT NULL,
        authenticity_score INTEGER,
        verification_status VARCHAR(50),
        applied_to_omniscore BOOLEAN DEFAULT false,
        applied_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_documents_user ON verification_documents(user_id);
      CREATE INDEX IF NOT EXISTS idx_verification_documents_status ON verification_documents(status);
      CREATE INDEX IF NOT EXISTS idx_document_verifications_document ON document_verifications(document_id);
      CREATE INDEX IF NOT EXISTS idx_document_verifications_user ON document_verifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_document_access_logs_document ON document_access_logs(document_id);
      CREATE INDEX IF NOT EXISTS idx_document_access_logs_accessed_by ON document_access_logs(accessed_by);
      CREATE INDEX IF NOT EXISTS idx_verified_credentials_user ON verified_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_document_score_impacts_user ON document_score_impacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_document_verifications_duplicate_hash ON document_verifications(duplicate_hash);
    `);

    console.log('Document verification tables created successfully');
  }
};
