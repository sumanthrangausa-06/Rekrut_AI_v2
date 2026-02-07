module.exports = async function(client) {
  // Add screening_questions column to jobs table
  await client.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions JSONB DEFAULT '[]'
  `);

  // Add screening_answers column to job_applications table
  await client.query(`
    ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS screening_answers JSONB DEFAULT '{}'
  `);

  console.log('Migration 022: Added screening_questions to jobs and screening_answers to job_applications');
};
