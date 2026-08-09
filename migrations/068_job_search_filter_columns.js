// Migration 068: Job search filter columns
//
// routes/candidate.js GET /api/candidate/jobs selects j.remote_type,
// j.experience_level and j.skills_required unconditionally. None of them was
// ever created by a migration, so on any database built purely from migrations
// the endpoint fails with "column j.remote_type does not exist" and returns
// 500 for every request — the candidate job search is completely unusable.
// Long-lived environments only work because the columns were added out of band.
//
// Values match the client unions in client/src/pages/candidate/jobs.tsx:
//   remote_type: 'remote' | 'hybrid' | 'onsite' | 'flexible'
//   skills_required: string[]
// experience_level is free text (e.g. 'entry', 'mid', 'senior').
//
// skills_required is TEXT[] because routes/recruiter.js reads it with
// UNNEST(skills_required), which requires an array type.

module.exports = {
	up: async (client) => {
		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS remote_type VARCHAR(20)
		`);

		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS experience_level VARCHAR(50)
		`);

		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS skills_required TEXT[]
		`);

		// Both columns are used as WHERE filters on the job search feed.
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_jobs_remote_type
			ON jobs(remote_type)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_jobs_experience_level
			ON jobs(experience_level)
		`);

		console.log('Migration 068: Job search filter columns added');
	},
};
