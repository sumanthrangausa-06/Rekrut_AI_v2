const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const clickhouse = require('../lib/clickhouse');
const { isEnabled } = require('../server/config/features');
const { optionalAuth, authMiddleware } = require('../lib/auth');
const analyticsSync = require('../server/services/analyticsSync');

// ───────────────────────────────────────────────
// EXISTING ROUTES — PostgreSQL only (unchanged)
// ───────────────────────────────────────────────

// Log an event (client-side tracking)
router.post('/events', optionalAuth, async (req, res) => {
	try {
		const { event_type, metadata = {} } = req.body;
		const user_id = req.user?.id || null;
		const session_id = req.headers['x-session-id'] || `anon_${req.ip}`;

		if (!event_type) {
			return res.status(400).json({ error: 'event_type is required' });
		}

		await pool.query(
			'INSERT INTO events (event_type, user_id, session_id, metadata) VALUES ($1, $2, $3, $4)',
			[event_type, user_id, session_id, JSON.stringify(metadata)],
		);

		res.json({ success: true });
	} catch (error) {
		console.error('Error logging event:', error);
		res.status(500).json({ error: 'Failed to log event' });
	}
});

// Get analytics dashboard data (authenticated recruiters only)
router.get('/dashboard', authMiddleware, async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		// Default to last 30 days if no dates provided
		const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const endDate = end_date || new Date().toISOString();

		// Page views by type
		const pageViewsResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT session_id) as unique_visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
      ORDER BY count DESC
    `,
			[startDate, endDate],
		);

		// Sign-up funnel
		const signupFunnelResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN ('page_view_landing', 'page_view_signup', 'signup_click', 'signup_complete_candidate', 'signup_complete_recruiter')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `,
			[startDate, endDate],
		);

		// Revenue funnel
		const revenueFunnelResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN (
        'page_view_pricing',
        'pricing_cycle_change',
        'pricing_cycle_toggle_click',
        'pricing_checkout_click',
        'pricing_checkout_confirmed',
        'pricing_checkout_canceled',
        'pricing_contact_sales_click'
      )
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `,
			[startDate, endDate],
		);

		// Feature engagement
		const featureEngagementResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM events
      WHERE event_type IN ('mock_interview_start', 'job_post_created', 'application_submitted', 'assessment_started')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
      ORDER BY count DESC
    `,
			[startDate, endDate],
		);

		// Daily visitors (last 30 days)
		const dailyVisitorsResult = await pool.query(
			`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
			[startDate, endDate],
		);

		// Conversion rates
		const landingViews =
			pageViewsResult.rows.find((r) => r.event_type === 'page_view_landing')?.unique_visitors || 0;
		const signupPageViews =
			pageViewsResult.rows.find((r) => r.event_type === 'page_view_signup')?.unique_visitors || 0;
		const pricingViews =
			pageViewsResult.rows.find((r) => r.event_type === 'page_view_pricing')?.unique_visitors || 0;
		const signupClicks =
			signupFunnelResult.rows.find((r) => r.event_type === 'signup_click')?.sessions || 0;
		const candidateSignups =
			signupFunnelResult.rows.find((r) => r.event_type === 'signup_complete_candidate')
				?.sessions || 0;
		const recruiterSignups =
			signupFunnelResult.rows.find((r) => r.event_type === 'signup_complete_recruiter')
				?.sessions || 0;
		const totalSignups = candidateSignups + recruiterSignups;
		const billingCycleToggles =
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_cycle_change')?.sessions ||
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_cycle_toggle_click')
				?.sessions ||
			0;
		const checkoutClicks =
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_checkout_click')?.sessions ||
			0;
		const checkoutConfirmed =
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_checkout_confirmed')
				?.sessions || 0;
		const checkoutCanceled =
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_checkout_canceled')
				?.sessions || 0;
		const contactSalesClicks =
			revenueFunnelResult.rows.find((r) => r.event_type === 'pricing_contact_sales_click')
				?.sessions || 0;

		res.json({
			success: true,
			data: {
				page_views: pageViewsResult.rows,
				signup_funnel: {
					landing_views: landingViews,
					signup_page_views: signupPageViews,
					signup_clicks: signupClicks,
					candidate_signups: candidateSignups,
					recruiter_signups: recruiterSignups,
					total_signups: totalSignups,
					conversion_rate:
						landingViews > 0 ? ((totalSignups / landingViews) * 100).toFixed(2) : '0.00',
					click_through_rate:
						landingViews > 0 ? ((signupClicks / landingViews) * 100).toFixed(2) : '0.00',
				},
				revenue_funnel: {
					pricing_views: pricingViews,
					billing_cycle_toggles: billingCycleToggles,
					checkout_clicks: checkoutClicks,
					checkout_confirmed: checkoutConfirmed,
					checkout_canceled: checkoutCanceled,
					contact_sales_clicks: contactSalesClicks,
					pricing_to_checkout_rate:
						pricingViews > 0 ? ((checkoutClicks / pricingViews) * 100).toFixed(2) : '0.00',
					checkout_completion_rate:
						checkoutClicks > 0 ? ((checkoutConfirmed / checkoutClicks) * 100).toFixed(2) : '0.00',
					enterprise_contact_rate:
						pricingViews > 0 ? ((contactSalesClicks / pricingViews) * 100).toFixed(2) : '0.00',
				},
				feature_engagement: featureEngagementResult.rows,
				daily_visitors: dailyVisitorsResult.rows,
				date_range: { start: startDate, end: endDate },
			},
		});
	} catch (error) {
		console.error('Error fetching analytics:', error);
		res.status(500).json({ error: 'Failed to fetch analytics data' });
	}
});

// ───────────────────────────────────────────────
// CLICKHOUSE ANALYTICS ROUTES (Issue #143)
// ───────────────────────────────────────────────
// These routes query ClickHouse when the feature flag is ON and ClickHouse
// is healthy. When the flag is OFF or ClickHouse is down, they fall back
// to equivalent PostgreSQL queries.

const RECRUITER_ROLES = ['employer', 'recruiter', 'hiring_manager', 'admin'];

function requireRecruiter(req, res, next) {
	if (!req.user) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	if (!RECRUITER_ROLES.includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

/**
 * GET /api/analytics/ch/test-stats
 * Test attempt statistics from ClickHouse (or PostgreSQL fallback).
 */
router.get('/ch/test-stats', authMiddleware, requireRecruiter, async (req, res) => {
	const useCh = isEnabled('useClickHouseAnalytics') && (await clickhouse.isHealthy());

	try {
		const { test_id, start_date, end_date } = req.query;
		const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const endDate = end_date || new Date().toISOString();

		if (useCh) {
			// ClickHouse query for fast aggregation
			const chQuery = `
        SELECT
          count() as total_attempts,
          countIf(status = 'completed') as completed_count,
          countIf(status = 'timed_out') as timed_out_count,
          avgIf(score, score IS NOT NULL) as avg_score,
          avgIf(max_score, max_score IS NOT NULL) as avg_max_score,
          avgIf(percentile, percentile IS NOT NULL) as avg_percentile,
          max(score) as highest_score,
          min(score) as lowest_score,
          avgIf(anti_cheat_score, anti_cheat_score IS NOT NULL) as avg_anti_cheat_score,
          avgIf(time_spent_seconds, time_spent_seconds IS NOT NULL) as avg_time_spent
        FROM test_attempts
        WHERE synced_at >= parseDateTimeBestEffort('${startDate}')
          AND synced_at <= parseDateTimeBestEffort('${endDate}')
          ${test_id ? `AND test_id = ${parseInt(test_id, 10)}` : ''}
      `;

			const result = await clickhouse.query({ query: chQuery, format: 'JSONEachRow' });
			const rows = await result.json();
			return res.json({
				success: true,
				source: 'clickhouse',
				stats: rows[0] || {},
				date_range: { start: startDate, end: endDate },
			});
		}

		// PostgreSQL fallback
		let query = `
      SELECT
        COUNT(*) as total_attempts,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'timed_out') as timed_out_count,
        ROUND(AVG(score) FILTER (WHERE status IN ('completed', 'timed_out')), 1) as avg_score,
        ROUND(AVG(max_score) FILTER (WHERE status IN ('completed', 'timed_out')), 1) as avg_max_score,
        ROUND(AVG(percentile) FILTER (WHERE percentile IS NOT NULL), 1) as avg_percentile,
        MAX(score) as highest_score,
        MIN(score) as lowest_score,
        ROUND(AVG(anti_cheat_score), 1) as avg_anti_cheat_score,
        ROUND(AVG(time_spent_seconds), 0) as avg_time_spent
      FROM aptitude_test_attempts
      WHERE status IN ('completed', 'timed_out')
        AND updated_at >= $1
        AND updated_at <= $2
    `;
		const params = [startDate, endDate];

		if (test_id) {
			query += ` AND test_id = $3`;
			params.push(parseInt(test_id, 10));
		}

		const result = await pool.query(query, params);
		res.json({
			success: true,
			source: 'postgresql',
			stats: result.rows[0] || {},
			date_range: { start: startDate, end: endDate },
		});
	} catch (error) {
		console.error('Error fetching test stats:', error);
		res.status(500).json({ error: 'Failed to fetch test statistics' });
	}
});

/**
 * GET /api/analytics/ch/score-distribution
 * Candidate score distribution from ClickHouse (or PostgreSQL fallback).
 */
router.get('/ch/score-distribution', authMiddleware, requireRecruiter, async (req, res) => {
	const useCh = isEnabled('useClickHouseAnalytics') && (await clickhouse.isHealthy());

	try {
		const { score_type } = req.query;

		if (useCh) {
			const chQuery = `
        SELECT
          CASE
            WHEN score_value < 400 THEN '0-399'
            WHEN score_value < 500 THEN '400-499'
            WHEN score_value < 600 THEN '500-599'
            WHEN score_value < 700 THEN '600-699'
            WHEN score_value < 800 THEN '700-799'
            ELSE '800+'
          END as bucket,
          count() as count,
          avg(score_value) as avg_score
        FROM candidate_scores
        WHERE score_type = '${score_type || 'omniscore'}'
        GROUP BY bucket
        ORDER BY bucket
      `;

			const result = await clickhouse.query({ query: chQuery, format: 'JSONEachRow' });
			const rows = await result.json();
			return res.json({
				success: true,
				source: 'clickhouse',
				score_type: score_type || 'omniscore',
				distribution: rows,
			});
		}

		// PostgreSQL fallback
		if (score_type === 'omniscore' || !score_type) {
			const result = await pool.query(`
        SELECT
          CASE
            WHEN total_score < 400 THEN '0-399'
            WHEN total_score < 500 THEN '400-499'
            WHEN total_score < 600 THEN '500-599'
            WHEN total_score < 700 THEN '600-699'
            WHEN total_score < 800 THEN '700-799'
            ELSE '800+'
          END as bucket,
          COUNT(*) as count,
          ROUND(AVG(total_score), 1) as avg_score
        FROM omni_scores
        GROUP BY bucket
        ORDER BY bucket
      `);
			return res.json({
				success: true,
				source: 'postgresql',
				score_type: 'omniscore',
				distribution: result.rows,
			});
		}

		res.json({
			success: true,
			source: 'postgresql',
			score_type: score_type || 'omniscore',
			distribution: [],
			message: 'Score type not available in PostgreSQL fallback',
		});
	} catch (error) {
		console.error('Error fetching score distribution:', error);
		res.status(500).json({ error: 'Failed to fetch score distribution' });
	}
});

/**
 * GET /api/analytics/ch/events-summary
 * Event summary from ClickHouse (or PostgreSQL fallback).
 */
router.get('/ch/events-summary', authMiddleware, requireRecruiter, async (req, res) => {
	const useCh = isEnabled('useClickHouseAnalytics') && (await clickhouse.isHealthy());

	try {
		const { start_date, end_date } = req.query;
		const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const endDate = end_date || new Date().toISOString();

		if (useCh) {
			const chQuery = `
        SELECT
          event_type,
          count() as count,
          uniqExact(user_id) as unique_users,
          uniqExact(session_id) as unique_sessions
        FROM analytics_events
        WHERE created_at >= parseDateTimeBestEffort('${startDate}')
          AND created_at <= parseDateTimeBestEffort('${endDate}')
        GROUP BY event_type
        ORDER BY count DESC
      `;

			const result = await clickhouse.query({ query: chQuery, format: 'JSONEachRow' });
			const rows = await result.json();
			return res.json({
				success: true,
				source: 'clickhouse',
				events: rows,
				date_range: { start: startDate, end: endDate },
			});
		}

		// PostgreSQL fallback
		const result = await pool.query(
			`
        SELECT
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT session_id) as unique_sessions
        FROM events
        WHERE created_at >= $1
          AND created_at <= $2
        GROUP BY event_type
        ORDER BY count DESC
      `,
			[startDate, endDate],
		);

		res.json({
			success: true,
			source: 'postgresql',
			events: result.rows,
			date_range: { start: startDate, end: endDate },
		});
	} catch (error) {
		console.error('Error fetching events summary:', error);
		res.status(500).json({ error: 'Failed to fetch events summary' });
	}
});

/**
 * GET /api/analytics/ch/sync-status
 * Get sync status for all ClickHouse tables.
 */
router.get('/ch/sync-status', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const status = await analyticsSync.getSyncStatus();
		const chHealth = await clickhouse.isHealthy();
		res.json({
			success: true,
			clickhouse: {
				healthy: chHealth,
				configured: !!process.env.CLICKHOUSE_URL,
			},
			sync_status: status,
			feature_flag: {
				useClickHouseAnalytics: isEnabled('useClickHouseAnalytics'),
			},
		});
	} catch (error) {
		console.error('Error fetching sync status:', error);
		res.status(500).json({ error: 'Failed to fetch sync status' });
	}
});

/**
 * POST /api/analytics/ch/sync
 * Trigger an on-demand sync to ClickHouse.
 */
router.post('/ch/sync', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		if (!isEnabled('useClickHouseAnalytics')) {
			return res.status(400).json({
				error: 'ClickHouse analytics is disabled',
				feature_flag: false,
			});
		}

		const { batchSize } = req.body || {};
		const result = await analyticsSync.runFullSync(batchSize || undefined);

		res.json({
			success: true,
			...result,
		});
	} catch (error) {
		console.error('Error triggering sync:', error);
		res.status(500).json({ error: 'Failed to trigger sync' });
	}
});

module.exports = router;
