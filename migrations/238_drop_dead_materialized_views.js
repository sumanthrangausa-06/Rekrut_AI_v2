/**
 * Migration 238: Drop 5 dead analytics materialized views.
 *
 * Views dropped:
 *   - mv_daily_metrics
 *   - mv_candidate_funnel
 *   - mv_company_engagement_summary
 *   - mv_time_to_hire
 *   - mv_candidate_skill_distribution
 *
 * Created in p3c_analytics_materialized_views.js but never integrated:
 *   - Zero REFRESH MATERIALIZED VIEW calls anywhere in the codebase
 *   - Zero references in routes/, lib/, services/, client/src/
 *   - Analytics endpoints query the `events` table directly + in-memory cache
 *
 * Verified dead before dropping (issue #520). Approved by Sumanth 2026-10-09.
 * DOWN is a no-op: the views were frozen snapshots from migration day and
 * contained no live data worth restoring.
 */
module.exports = {
	name: '238_drop_dead_materialized_views',
	up: async (client) => {
		await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_daily_metrics;');
		await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_candidate_funnel;');
		await client.query(
			'DROP MATERIALIZED VIEW IF EXISTS mv_company_engagement_summary;'
		);
		await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_time_to_hire;');
		await client.query(
			'DROP MATERIALIZED VIEW IF EXISTS mv_candidate_skill_distribution;'
		);
	},
	down: async () => {
		// No-op: views were dead snapshots, nothing to restore.
	},
};
