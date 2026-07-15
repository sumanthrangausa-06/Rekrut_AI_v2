const express = require('express');
const router = express.Router();
const pool = require('../lib/db');

// ─── Email Tracking Pixel — records email opens ───────────────────────────
// Returns a 1x1 transparent GIF
router.get('/track/open/:logId', async (req, res) => {
	const { logId } = req.params;

	try {
		await pool.query(
			`
			UPDATE notification_logs
			SET opened_at = COALESCE(opened_at, NOW())
			WHERE id = $1 AND opened_at IS NULL
		`,
			[logId],
		);
	} catch (err) {
		console.error('[email-track] Failed to record open:', err.message);
	}

	// Return 1x1 transparent GIF
	const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
	res.setHeader('Content-Type', 'image/gif');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
	res.send(pixel);
});

// ─── Email Click Tracking — redirects and records clicks ────────────────────
router.get('/track/click/:logId', async (req, res) => {
	const { logId } = req.params;
	const { url } = req.query;

	if (!url) {
		return res.status(400).send('Missing URL parameter');
	}

	try {
		await pool.query(
			`
			UPDATE notification_logs
			SET clicked_at = NOW(),
			    metadata = jsonb_set(
			      COALESCE(metadata, '{}'),
			      '{clicked_url}',
			      to_jsonb($2::text)
			    )
			WHERE id = $1
		`,
			[logId, url],
		);
	} catch (err) {
		console.error('[email-track] Failed to record click:', err.message);
	}

	// Redirect to the actual URL
	res.redirect(url);
});

// ─── Email Analytics Dashboard API ────────────────────────────────────────
router.get('/analytics', async (req, res) => {
	try {
		const { timeRange = '30' } = req.query;
		const days = parseInt(timeRange, 10) || 30;
		const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

		// Overview stats
		const overviewResult = await pool.query(
			`
			SELECT
				COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
				COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as open_count,
				COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as click_count,
				COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
				COUNT(*) FILTER (WHERE status = 'bounced') as bounced_count
			FROM notification_logs
			WHERE created_at >= $1
		`,
			[since],
		);

		const overview = overviewResult.rows[0];
		const sent = parseInt(overview.sent_count, 10) || 0;
		const openRate =
			sent > 0 ? Math.round(((parseInt(overview.open_count, 10) || 0) / sent) * 100) : 0;
		const clickRate =
			sent > 0 ? Math.round(((parseInt(overview.click_count, 10) || 0) / sent) * 100) : 0;
		const bounceRate =
			sent > 0 ? Math.round(((parseInt(overview.bounced_count, 10) || 0) / sent) * 100) : 0;

		// Daily breakdown
		const dailyResult = await pool.query(
			`
			SELECT
				DATE(created_at) as date,
				COUNT(*) FILTER (WHERE status = 'sent') as sent,
				COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opens,
				COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as clicks
			FROM notification_logs
			WHERE created_at >= $1
			GROUP BY DATE(created_at)
			ORDER BY date DESC
			LIMIT 30
		`,
			[since],
		);

		// Template performance
		const templateResult = await pool.query(
			`
			SELECT
				nt.name as template_name,
				COUNT(*) as total_sent,
				COUNT(*) FILTER (WHERE nl.opened_at IS NOT NULL) as opens,
				COUNT(*) FILTER (WHERE nl.clicked_at IS NOT NULL) as clicks
			FROM notification_logs nl
			LEFT JOIN notification_templates nt ON nl.template_id = nt.id
			WHERE nl.created_at >= $1 AND nl.status = 'sent'
			GROUP BY nt.name
			ORDER BY total_sent DESC
			LIMIT 10
		`,
			[since],
		);

		// Recent activity
		const recentResult = await pool.query(
			`
			SELECT
				nl.id,
				nl.email,
				nt.name as template_name,
				nl.status,
				nl.created_at,
				nl.opened_at,
				nl.clicked_at
			FROM notification_logs nl
			LEFT JOIN notification_templates nt ON nl.template_id = nt.id
			WHERE nl.created_at >= $1
			ORDER BY nl.created_at DESC
			LIMIT 50
		`,
			[since],
		);

		res.json({
			overview: {
				sent,
				opens: parseInt(overview.open_count, 10) || 0,
				clicks: parseInt(overview.click_count, 10) || 0,
				failed: parseInt(overview.failed_count, 10) || 0,
				bounced: parseInt(overview.bounced_count, 10) || 0,
				openRate,
				clickRate,
				bounceRate,
			},
			daily: dailyResult.rows.map((row) => ({
				date: row.date,
				sent: parseInt(row.sent, 10),
				opens: parseInt(row.opens, 10),
				clicks: parseInt(row.clicks, 10),
			})),
			templates: templateResult.rows.map((row) => ({
				name: row.template_name || 'Custom',
				sent: parseInt(row.total_sent, 10),
				opens: parseInt(row.opens, 10),
				clicks: parseInt(row.clicks, 10),
				openRate:
					parseInt(row.total_sent, 10) > 0
						? Math.round((parseInt(row.opens, 10) / parseInt(row.total_sent, 10)) * 100)
						: 0,
			})),
			recent: recentResult.rows.map((row) => ({
				id: row.id,
				email: row.email,
				template: row.template_name || 'Custom',
				status: row.status,
				createdAt: row.created_at,
				openedAt: row.opened_at,
				clickedAt: row.clicked_at,
			})),
		});
	} catch (err) {
		console.error('[email-analytics] Failed to get analytics:', err.message);
		res.status(500).json({ error: 'Failed to get email analytics' });
	}
});

module.exports = router;
