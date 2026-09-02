const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const calendarService = require('../server/services/calendar-service');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// OAuth — Initiate connection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/calendar/connect/google
 * Initiate Google Calendar OAuth flow. Returns the auth URL for the frontend to redirect.
 */
router.post('/connect/google', authMiddleware, async (req, res) => {
	try {
		const state = Buffer.from(JSON.stringify({ userId: req.user.id, provider: 'google' })).toString(
			'base64',
		);
		const url = calendarService.getGoogleAuthUrl(state);
		res.json({ success: true, authUrl: url });
	} catch (err) {
		console.error('[calendar] Google connect error:', err.message);
		res.status(500).json({ error: 'Failed to initiate Google Calendar connection' });
	}
});

/**
 * POST /api/calendar/connect/outlook
 * Initiate Microsoft Outlook OAuth flow. Returns the auth URL for the frontend to redirect.
 */
router.post('/connect/outlook', authMiddleware, async (req, res) => {
	try {
		const state = Buffer.from(
			JSON.stringify({ userId: req.user.id, provider: 'outlook' }),
		).toString('base64');
		const url = calendarService.getOutlookAuthUrl(state);
		res.json({ success: true, authUrl: url });
	} catch (err) {
		console.error('[calendar] Outlook connect error:', err.message);
		res.status(500).json({ error: 'Failed to initiate Outlook Calendar connection' });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth — Callback (handles both Google and Outlook)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/calendar/oauth/callback
 * Handles OAuth callback from both Google and Outlook. Exchanges code for tokens and stores them.
 * Query params: ?code=...&state=...[&error=...]
 */
router.get('/oauth/callback', async (req, res) => {
	try {
		const { code, state, error } = req.query;

		if (error) {
			console.error('[calendar] OAuth error from provider:', error);
			return res.redirect(
				`${process.env.FRONTEND_URL || 'https://rekrut.ai'}/settings/calendar?error=${encodeURIComponent(error)}`,
			);
		}

		if (!code || !state) {
			return res.status(400).json({ error: 'Missing code or state parameter' });
		}

		let parsedState;
		try {
			parsedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
		} catch {
			return res.status(400).json({ error: 'Invalid state parameter' });
		}

		const { userId, provider } = parsedState;
		if (!userId || !provider) {
			return res.status(400).json({ error: 'Invalid state payload' });
		}

		let tokens;
		if (provider === 'google') {
			tokens = await calendarService.exchangeGoogleCode(code);
		} else if (provider === 'outlook') {
			tokens = await calendarService.exchangeOutlookCode(code);
		} else {
			return res.status(400).json({ error: 'Unsupported provider' });
		}

		await calendarService.upsertConnection(userId, provider, tokens);

		// Redirect back to frontend settings page with success indicator
		res.redirect(
			`${process.env.FRONTEND_URL || 'https://rekrut.ai'}/settings/calendar?success=${provider}`,
		);
	} catch (err) {
		console.error('[calendar] OAuth callback error:', err.message);
		res.redirect(
			`${process.env.FRONTEND_URL || 'https://rekrut.ai'}/settings/calendar?error=calendar_connection_failed`,
		);
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/calendar/disconnect
 * Disconnect a calendar provider for the authenticated user.
 * Body: { provider: 'google' | 'outlook' }
 */
router.post('/disconnect', authMiddleware, async (req, res) => {
	try {
		const { provider } = req.body;
		if (!provider || !['google', 'outlook'].includes(provider)) {
			return res.status(400).json({ error: 'Provider must be "google" or "outlook"' });
		}

		await calendarService.revokeConnection(req.user.id, provider);
		res.json({ success: true, message: `${provider} calendar disconnected` });
	} catch (err) {
		console.error('[calendar] Disconnect error:', err.message);
		res.status(500).json({ error: 'Failed to disconnect calendar' });
	}
});

/**
 * GET /api/calendar/status
 * Check which calendar providers the authenticated user has connected.
 */
router.get('/status', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT provider, calendar_id, is_active, created_at, updated_at
       FROM calendar_connections
       WHERE user_id = $1 AND is_active = true`,
			[req.user.id],
		);

		const connections = {};
		for (const row of result.rows) {
			connections[row.provider] = {
				connected: true,
				calendarId: row.calendar_id,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			};
		}

		res.json({
			google: connections.google || { connected: false },
			outlook: connections.outlook || { connected: false },
		});
	} catch (err) {
		console.error('[calendar] Status error:', err.message);
		res.status(500).json({ error: 'Failed to fetch calendar status' });
	}
});

/**
 * GET /api/calendar/connections
 * List user's connected calendars with full metadata.
 */
router.get('/connections', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT
				provider,
				calendar_id,
				calendar_email,
				is_active,
				expires_at,
				created_at,
				updated_at
			 FROM calendar_connections
			 WHERE user_id = $1 AND is_active = true
			 ORDER BY provider`,
			[req.user.id],
		);

		res.json({
			success: true,
			connections: result.rows,
		});
	} catch (err) {
		console.error('[calendar] Connections error:', err.message);
		res.status(500).json({ error: 'Failed to fetch calendar connections' });
	}
});

/**
 * POST /api/calendar/availability
 * Check mutual availability across a set of users for a date range.
 * Body: { user_ids: number[], time_min: ISO8601, time_max: ISO8601 }
 */
router.post('/availability', authMiddleware, rateLimits.strict, async (req, res) => {
	try {
		const { user_ids, time_min, time_max } = req.body;

		if (!Array.isArray(user_ids) || user_ids.length === 0 || user_ids.length > 20) {
			return res.status(400).json({ error: 'user_ids must be an array of 1-20 user IDs' });
		}
		if (!time_min || !time_max) {
			return res.status(400).json({ error: 'time_min and time_max are required' });
		}

		const tMin = new Date(time_min);
		const tMax = new Date(time_max);
		if (Number.isNaN(tMin.getTime()) || Number.isNaN(tMax.getTime())) {
			return res.status(400).json({ error: 'Invalid date format' });
		}
		if (tMax <= tMin) {
			return res.status(400).json({ error: 'time_max must be after time_min' });
		}
		if (tMax.getTime() - tMin.getTime() > 31 * 24 * 60 * 60 * 1000) {
			return res.status(400).json({ error: 'Date range cannot exceed 31 days' });
		}

		// Authorization: users can check their own availability + panel members they work with
		const requestingUserId = req.user.id;
		const isRequestingUserIncluded = user_ids.includes(requestingUserId);
		const isRec = ['recruiter', 'hiring_manager', 'employer', 'admin'].includes(req.user.role);

		if (!isRequestingUserIncluded && !isRec) {
			return res
				.status(403)
				.json({ error: 'You can only check availability for yourself or your panel members' });
		}

		const availability = await calendarService.checkAvailability(user_ids, tMin, tMax);

		res.json({
			success: true,
			time_min: tMin.toISOString(),
			time_max: tMax.toISOString(),
			availability,
		});
	} catch (err) {
		console.error('[calendar] Availability error:', err.message);
		res.status(500).json({ error: 'Failed to check availability' });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Event management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/calendar/events/:interviewId
 * Manually create or update a calendar event for a specific interview.
 * Body: { provider?: 'google' | 'outlook' } — optional, defaults to user's first active connection.
 */
router.post('/events/:interviewId', authMiddleware, async (req, res) => {
	try {
		const { interviewId } = req.params;
		let { provider } = req.body;

		// Fetch interview
		const interviewRes = await pool.query('SELECT * FROM scheduled_interviews WHERE id = $1', [
			interviewId,
		]);
		if (interviewRes.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found' });
		}
		const interview = interviewRes.rows[0];

		// Verify user is involved in this interview (recruiter or candidate)
		if (interview.recruiter_id !== req.user.id && interview.candidate_id !== req.user.id) {
			return res.status(403).json({ error: 'Not authorized to sync this interview' });
		}

		// Auto-detect provider if not specified
		if (!provider) {
			const conn =
				(await calendarService.getConnection(req.user.id, 'google')) ||
				(await calendarService.getConnection(req.user.id, 'outlook'));
			if (!conn) {
				return res.status(400).json({
					error: 'No active calendar connection. Please connect Google or Outlook calendar first.',
				});
			}
			provider = conn.provider;
		}

		let eventId;
		if (interview.calendar_event_id && interview.calendar_provider === provider) {
			// Update existing
			eventId = await calendarService.updateCalendarEvent(
				req.user.id,
				provider,
				interview.calendar_event_id,
				interview,
			);
		} else {
			// Create new
			eventId = await calendarService.createCalendarEvent(req.user.id, provider, interview);
		}

		res.json({ success: true, eventId, provider, interviewId });
	} catch (err) {
		console.error('[calendar] Event sync error:', err.message);
		res.status(500).json({ error: 'Failed to sync calendar event' });
	}
});

/**
 * DELETE /api/calendar/events/:interviewId
 * Delete the calendar event associated with an interview.
 */
router.delete('/events/:interviewId', authMiddleware, async (req, res) => {
	try {
		const { interviewId } = req.params;

		const interviewRes = await pool.query('SELECT * FROM scheduled_interviews WHERE id = $1', [
			interviewId,
		]);
		if (interviewRes.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found' });
		}
		const interview = interviewRes.rows[0];

		if (interview.recruiter_id !== req.user.id && interview.candidate_id !== req.user.id) {
			return res.status(403).json({ error: 'Not authorized to unsync this interview' });
		}

		if (!interview.calendar_event_id || !interview.calendar_provider) {
			return res.status(400).json({ error: 'No calendar event linked to this interview' });
		}

		await calendarService.deleteCalendarEvent(
			req.user.id,
			interview.calendar_provider,
			interview.calendar_event_id,
		);
		await pool.query(
			`UPDATE scheduled_interviews SET calendar_event_id = NULL, calendar_provider = NULL, updated_at = NOW() WHERE id = $1`,
			[interviewId],
		);

		res.json({ success: true, message: 'Calendar event removed' });
	} catch (err) {
		console.error('[calendar] Event delete error:', err.message);
		res.status(500).json({ error: 'Failed to delete calendar event' });
	}
});

/**
 * GET /api/calendar/events
 * List synced calendar events for the authenticated user (read from local DB, not provider APIs).
 */
router.get('/events', authMiddleware, async (req, res) => {
	try {
		const { limit = 50, offset = 0 } = req.query;

		const result = await pool.query(
			`
      SELECT
        si.id as interview_id,
        si.job_id,
        si.candidate_id,
        si.recruiter_id,
        si.scheduled_at,
        si.duration_minutes,
        si.interview_type,
        si.meeting_link,
        si.status,
        si.calendar_event_id,
        si.calendar_provider,
        j.title as job_title
      FROM scheduled_interviews si
      LEFT JOIN jobs j ON si.job_id = j.id
      WHERE (si.recruiter_id = $1 OR si.candidate_id = $1)
        AND si.calendar_event_id IS NOT NULL
      ORDER BY si.scheduled_at DESC
      LIMIT $2 OFFSET $3
    `,
			[req.user.id, limit, offset],
		);

		res.json({ events: result.rows, count: result.rows.length });
	} catch (err) {
		console.error('[calendar] List events error:', err.message);
		res.status(500).json({ error: 'Failed to list synced events' });
	}
});

module.exports = router;
