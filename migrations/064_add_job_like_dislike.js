// Migration: Add like/dislike (swipe) system for job cards
// Tracks candidate actions (like, dismiss) on jobs

module.exports = {
	name: '064_add_job_like_dislike',
	up: async (client) => {
		// Job actions table for like/dismiss tracking
		await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_job_actions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('like', 'dismiss')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, job_id, action_type)
      )
    `);

		// Indexes for performance
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_candidate_job_actions_user ON candidate_job_actions(user_id)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_candidate_job_actions_job ON candidate_job_actions(job_id)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_candidate_job_actions_type ON candidate_job_actions(action_type)`,
		);

		console.log('Job like/dislike tables created');
	},
};
