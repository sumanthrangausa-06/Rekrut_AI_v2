module.exports = {
  name: '003_add_company_profile_fields',
  async up(client) {
    await client.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS culture_description TEXT,
      ADD COLUMN IF NOT EXISTS core_values JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS benefits JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS office_locations JSONB DEFAULT '[]'::jsonb
    `);

    console.log('✅ Added company profile fields (culture, values, benefits, locations)');
  }
};
