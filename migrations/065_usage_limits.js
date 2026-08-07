/**
 * Migration: usage_limits table for Free vs Pro tier feature gating (#35)
 *
 * Tracks daily / monthly usage per user per feature.
 */
module.exports = {
	name: 'usage_limits',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS usage_limits (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				feature VARCHAR(100) NOT NULL,
				period_key VARCHAR(10) NOT NULL,
				usage_count INTEGER NOT NULL DEFAULT 0,
				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW(),
				UNIQUE (user_id, feature, period_key)
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_usage_limits_user_feature
			ON usage_limits(user_id, feature, period_key)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_usage_limits_period
			ON usage_limits(period_key)
		`);

		console.log('[migration] usage_limits table created');
	},
};
