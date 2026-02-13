module.exports = {
  name: '040_communication_hub',
  async up(client) {
    // Core communications table — every message (outreach, follow-up, rejection, offer letter, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS communications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        recruiter_id INTEGER REFERENCES users(id),
        candidate_id INTEGER REFERENCES users(id),
        job_id INTEGER REFERENCES jobs(id),
        type VARCHAR(50) NOT NULL, -- outreach, follow_up, rejection, offer_letter, interview_confirmation, interview_reminder, custom
        subject VARCHAR(500),
        body TEXT NOT NULL,
        tone VARCHAR(50) DEFAULT 'professional', -- formal, conversational, executive, friendly
        status VARCHAR(50) DEFAULT 'draft', -- draft, sent, delivered, read, replied, bounced
        sent_at TIMESTAMP,
        read_at TIMESTAMP,
        replied_at TIMESTAMP,
        metadata JSONB DEFAULT '{}', -- pipeline results, compliance flags, personalization context
        parent_id INTEGER REFERENCES communications(id), -- for threading
        sequence_id INTEGER, -- links to communication_sequences
        sequence_step INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Communication templates — reusable AI-generated or custom templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS communication_templates (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        subject_template VARCHAR(500),
        body_template TEXT NOT NULL,
        tone VARCHAR(50) DEFAULT 'professional',
        variables JSONB DEFAULT '[]', -- [{name: "candidate_name", required: true}]
        usage_count INTEGER DEFAULT 0,
        avg_response_rate NUMERIC(5,2) DEFAULT 0,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Communication sequences — automated follow-up chains
    await client.query(`
      CREATE TABLE IF NOT EXISTS communication_sequences (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        steps JSONB DEFAULT '[]', -- [{delay_days: 3, type: "follow_up", tone: "friendly", template_id: null}]
        status VARCHAR(50) DEFAULT 'active', -- active, paused, archived
        total_enrolled INTEGER DEFAULT 0,
        total_replied INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Candidate sequence enrollment — tracks which candidates are in which sequences
    await client.query(`
      CREATE TABLE IF NOT EXISTS sequence_enrollments (
        id SERIAL PRIMARY KEY,
        sequence_id INTEGER REFERENCES communication_sequences(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id),
        job_id INTEGER REFERENCES jobs(id),
        company_id INTEGER NOT NULL,
        current_step INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active', -- active, completed, replied, unsubscribed, paused
        next_send_at TIMESTAMP,
        enrolled_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_company ON communications(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_candidate ON communications(candidate_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_status ON communications(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comm_templates_company ON communication_templates(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_comm_sequences_company ON communication_sequences(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_seq_enrollments_next_send ON sequence_enrollments(next_send_at) WHERE status = 'active'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_seq_enrollments_candidate ON sequence_enrollments(candidate_id)`);

    console.log('Created communication hub tables: communications, communication_templates, communication_sequences, sequence_enrollments');
  }
};
