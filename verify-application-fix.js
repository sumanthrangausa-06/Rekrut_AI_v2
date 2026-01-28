// Verification script for application company_id fix
const pool = require('./lib/db');

async function verify() {
  try {
    console.log('Verifying job applications have company_id...');

    // Check if any applications are missing company_id
    const missingCompanyId = await pool.query(`
      SELECT COUNT(*) as count
      FROM job_applications
      WHERE company_id IS NULL
    `);

    console.log(`Applications missing company_id: ${missingCompanyId.rows[0].count}`);

    // Check that applications can be queried by company_id
    const appsByCompany = await pool.query(`
      SELECT company_id, COUNT(*) as count
      FROM job_applications
      WHERE company_id IS NOT NULL
      GROUP BY company_id
    `);

    console.log('Applications by company:');
    appsByCompany.rows.forEach(row => {
      console.log(`  Company ${row.company_id}: ${row.count} applications`);
    });

    // Verify that new applications would have correct company_id
    const jobsWithCompany = await pool.query(`
      SELECT j.id, j.title, j.company_id, j.company
      FROM jobs j
      WHERE j.company_id IS NOT NULL
      LIMIT 5
    `);

    console.log('\nSample jobs with company_id:');
    jobsWithCompany.rows.forEach(job => {
      console.log(`  Job ${job.id} (${job.title}): company_id=${job.company_id}`);
    });

    if (missingCompanyId.rows[0].count > 0) {
      console.error('\nVERIFICATION FAILED: Some applications still missing company_id');
      process.exit(1);
    }

    console.log('\nVerification PASSED: All applications have company_id');
    process.exit(0);
  } catch (err) {
    console.error('Verification ERROR:', err.message);
    process.exit(1);
  }
}

verify();
