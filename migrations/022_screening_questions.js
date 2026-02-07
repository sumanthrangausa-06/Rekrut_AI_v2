module.exports = {
  name: 'screening_questions',
  up: async (client) => {
    // Add screening_questions column to jobs table
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions JSONB DEFAULT '[]'
    `);

    // Add screening_answers column to job_applications table
    await client.query(`
      ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS screening_answers JSONB DEFAULT '{}'
    `);

    // Seed default screening questions for existing jobs that have none
    await client.query(`
      UPDATE jobs SET screening_questions = $1
      WHERE screening_questions IS NULL OR screening_questions = '[]'::jsonb
    `, [JSON.stringify([
      {
        id: 'sq_default_1',
        question: 'Are you legally authorized to work in this country?',
        type: 'yes_no',
        required: true,
        category: 'work_authorization'
      },
      {
        id: 'sq_default_2',
        question: 'What are your salary expectations? (annual, USD)',
        type: 'text',
        required: false,
        placeholder: 'e.g. $80,000 - $100,000',
        category: 'salary'
      },
      {
        id: 'sq_default_3',
        question: 'When can you start?',
        type: 'select',
        required: true,
        options: ['Immediately', 'Within 2 weeks', 'Within 1 month', 'More than 1 month'],
        category: 'availability'
      },
      {
        id: 'sq_default_4',
        question: 'Are you willing to relocate for this position?',
        type: 'yes_no',
        required: false,
        category: 'relocation'
      },
      {
        id: 'sq_default_5',
        question: 'How many years of relevant experience do you have?',
        type: 'select',
        required: true,
        options: ['0-1 years', '1-3 years', '3-5 years', '5-10 years', '10+ years'],
        category: 'experience'
      }
    ])]);

    console.log('Migration 022: Added screening_questions to jobs and screening_answers to job_applications');
  }
};
