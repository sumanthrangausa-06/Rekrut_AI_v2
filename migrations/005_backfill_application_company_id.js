module.exports = {
  name: '005_backfill_application_company_id',
  async up(client) {
    console.log('Backfilling company_id for job_applications...');

    // Update applications with missing company_id by joining with jobs table
    await client.query(`
      UPDATE job_applications ja
      SET company_id = j.company_id
      FROM jobs j
      WHERE ja.job_id = j.id
        AND ja.company_id IS NULL
        AND j.company_id IS NOT NULL
    `);

    console.log('job_applications company_id backfill complete');
  }
};
