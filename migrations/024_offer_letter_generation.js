module.exports = {
  name: '024_offer_letter_generation',
  async up(client) {
    // Add offer letter content columns
    await client.query(`
      ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS offer_letter_html TEXT,
      ADD COLUMN IF NOT EXISTS offer_letter_generated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS reporting_to VARCHAR(255),
      ADD COLUMN IF NOT EXISTS location VARCHAR(255),
      ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50) DEFAULT 'full-time',
      ADD COLUMN IF NOT EXISTS candidate_signature TEXT,
      ADD COLUMN IF NOT EXISTS candidate_signed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS candidate_sign_ip VARCHAR(100)
    `);

    console.log('Added offer letter generation columns to offers table');
  }
};
