const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { optionalAuth, authMiddleware } = require('../lib/auth');

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
      [event_type, user_id, session_id, JSON.stringify(metadata)]
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
    const pageViewsResult = await pool.query(`
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
    `, [startDate, endDate]);

    // Sign-up funnel
    const signupFunnelResult = await pool.query(`
      SELECT
        event_type,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN ('page_view_landing', 'page_view_signup', 'signup_click', 'signup_complete_candidate', 'signup_complete_recruiter')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `, [startDate, endDate]);

    // Feature engagement
    const featureEngagementResult = await pool.query(`
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
    `, [startDate, endDate]);

    // Daily visitors (last 30 days)
    const dailyVisitorsResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [startDate, endDate]);

    // Conversion rates
    const landingViews = pageViewsResult.rows.find(r => r.event_type === 'page_view_landing')?.unique_visitors || 0;
    const signupPageViews = pageViewsResult.rows.find(r => r.event_type === 'page_view_signup')?.unique_visitors || 0;
    const signupClicks = signupFunnelResult.rows.find(r => r.event_type === 'signup_click')?.sessions || 0;
    const candidateSignups = signupFunnelResult.rows.find(r => r.event_type === 'signup_complete_candidate')?.sessions || 0;
    const recruiterSignups = signupFunnelResult.rows.find(r => r.event_type === 'signup_complete_recruiter')?.sessions || 0;
    const totalSignups = candidateSignups + recruiterSignups;

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
          conversion_rate: landingViews > 0 ? ((totalSignups / landingViews) * 100).toFixed(2) : '0.00',
          click_through_rate: landingViews > 0 ? ((signupClicks / landingViews) * 100).toFixed(2) : '0.00'
        },
        feature_engagement: featureEngagementResult.rows,
        daily_visitors: dailyVisitorsResult.rows,
        date_range: { start: startDate, end: endDate }
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

module.exports = router;
