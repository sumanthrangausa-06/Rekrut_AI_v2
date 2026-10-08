/**
 * Expand job_applications status CHECK constraint to include the
 * recruiter Kanban stages 'shortlisted' and 'reviewing'.
 * The frontend Kanban already offers these stages; the backend rejected them.
 */
async function up(client) {
	await client.query(`ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS chk_job_applications_status`);
	await client.query(`
    ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_status
      CHECK (status IN ('applied','screening','shortlisted','reviewing','interviewed','offered','hired','rejected','withdrawn'))
  `);
	console.log('[migration] job_applications status constraint expanded with shortlisted/reviewing');

	// Allow 'assigned' for recruiter-assigned assessment attempts (candidate hasn't started yet)
	await client.query(
		`ALTER TABLE job_assessment_attempts DROP CONSTRAINT IF EXISTS chk_job_assessment_attempts_status`,
	);
	await client.query(`
    ALTER TABLE job_assessment_attempts ADD CONSTRAINT chk_job_assessment_attempts_status
      CHECK (status IN ('assigned','in_progress','completed','expired','abandoned'))
  `);
	console.log('[migration] job_assessment_attempts status constraint expanded with assigned');
}

async function down(client) {
	await client.query(`ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS chk_job_applications_status`);
	await client.query(`
    ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_status
      CHECK (status IN ('applied','screening','interviewed','offered','hired','rejected','withdrawn'))
  `);
	await client.query(
		`ALTER TABLE job_assessment_attempts DROP CONSTRAINT IF EXISTS chk_job_assessment_attempts_status`,
	);
	await client.query(`
    ALTER TABLE job_assessment_attempts ADD CONSTRAINT chk_job_assessment_attempts_status
      CHECK (status IN ('in_progress','completed','expired','abandoned'))
  `);
}

module.exports = { up, down };
