const { google } = require('googleapis');
const { AuthorizationCode } = require('simple-oauth2');
const pool = require('../../lib/db');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_REDIRECT_URI =
	process.env.GOOGLE_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://rekrut.ai'}/api/calendar/oauth/callback`;
const OUTLOOK_REDIRECT_URI =
	process.env.OUTLOOK_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://rekrut.ai'}/api/calendar/oauth/callback`;

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const OUTLOOK_SCOPES = 'https://graph.microsoft.com/Calendars.ReadWrite';

// Google OAuth2 client (lazy init — env may not be set in test/dev)
function getGoogleClient() {
	if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
		throw new Error('Google Calendar OAuth credentials not configured');
	}
	return new google.auth.OAuth2(
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET,
		GOOGLE_REDIRECT_URI,
	);
}

// Outlook OAuth2 client
function getOutlookClient() {
	if (!process.env.OUTLOOK_CLIENT_ID || !process.env.OUTLOOK_CLIENT_SECRET) {
		throw new Error('Outlook Calendar OAuth credentials not configured');
	}
	return new AuthorizationCode({
		client: {
			id: process.env.OUTLOOK_CLIENT_ID,
			secret: process.env.OUTLOOK_CLIENT_SECRET,
		},
		auth: {
			tokenHost: 'https://login.microsoftonline.com',
			tokenPath: '/common/oauth2/v2.0/token',
			authorizePath: '/common/oauth2/v2.0/authorize',
		},
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store or update a calendar connection in the database.
 */
async function upsertConnection(userId, provider, tokens, calendarId = 'primary') {
	const accessToken = tokens.access_token || tokens.accessToken;
	const refreshToken = tokens.refresh_token || tokens.refreshToken;
	const expiresAt = tokens.expiry_date
		? new Date(tokens.expiry_date)
		: tokens.expires_at
			? new Date(tokens.expires_at)
			: null;

	await pool.query(
		`
    INSERT INTO calendar_connections (user_id, provider, access_token, refresh_token, expires_at, calendar_id, is_active, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
      expires_at = EXCLUDED.expires_at,
      calendar_id = EXCLUDED.calendar_id,
      is_active = true,
      updated_at = NOW()
  `,
		[userId, provider, accessToken, refreshToken, expiresAt, calendarId],
	);
}

/**
 * Get a user's active calendar connection for a provider.
 */
async function getConnection(userId, provider) {
	const result = await pool.query(
		`SELECT * FROM calendar_connections WHERE user_id = $1 AND provider = $2 AND is_active = true`,
		[userId, provider],
	);
	return result.rows[0] || null;
}

/**
 * Revoke a connection (soft-delete).
 */
async function revokeConnection(userId, provider) {
	await pool.query(
		`UPDATE calendar_connections SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND provider = $2`,
		[userId, provider],
	);
}

/**
 * Refresh Google access token if expired.
 */
async function refreshGoogleToken(connection) {
	if (!connection.refresh_token) return connection;

	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({
		refresh_token: connection.refresh_token,
	});

	try {
		const { credentials } = await oauth2Client.refreshAccessToken();
		await upsertConnection(connection.user_id, 'google', credentials, connection.calendar_id);
		return { ...connection, access_token: credentials.access_token, expires_at: new Date(credentials.expiry_date) };
	} catch (err) {
		console.error('[calendar-service] Google token refresh failed:', err.message);
		// Mark inactive if refresh fails permanently
		if (err.message?.includes('invalid_grant')) {
			await revokeConnection(connection.user_id, 'google');
		}
		throw err;
	}
}

/**
 * Refresh Outlook access token if expired.
 */
async function refreshOutlookToken(connection) {
	if (!connection.refresh_token) return connection;

	const client = getOutlookClient();

	try {
		const accessToken = client.createToken({
			access_token: connection.access_token,
			refresh_token: connection.refresh_token,
			expires_at: connection.expires_at,
		});
		const newAccessToken = await accessToken.refresh({ scope: OUTLOOK_SCOPES });
		const token = newAccessToken.token;
		await upsertConnection(connection.user_id, 'outlook', token, connection.calendar_id);
		return { ...connection, access_token: token.access_token, expires_at: new Date(token.expires_at) };
	} catch (err) {
		console.error('[calendar-service] Outlook token refresh failed:', err.message);
		if (err.message?.includes('invalid_grant')) {
			await revokeConnection(connection.user_id, 'outlook');
		}
		throw err;
	}
}

/**
 * Ensure token is fresh for a provider.
 */
async function ensureFreshToken(connection) {
	if (!connection) return null;

	const now = new Date();
	const expiresAt = connection.expires_at ? new Date(connection.expires_at) : null;
	const isExpired = !expiresAt || expiresAt <= new Date(now.getTime() + 5 * 60 * 1000); // 5 min buffer

	if (!isExpired) return connection;

	if (connection.provider === 'google') return refreshGoogleToken(connection);
	if (connection.provider === 'outlook') return refreshOutlookToken(connection);
	return connection;
}

/**
 * Build calendar event details from an interview record.
 */
async function buildEventPayload(interview) {
	// Fetch candidate and recruiter emails + job title
	const [candidateRes, recruiterRes, jobRes] = await Promise.all([
		pool.query('SELECT name, email FROM users WHERE id = $1', [interview.candidate_id]),
		pool.query('SELECT name, email FROM users WHERE id = $1', [interview.recruiter_id]),
		pool.query('SELECT title FROM jobs WHERE id = $1', [interview.job_id]),
	]);

	const candidate = candidateRes.rows[0] || {};
	const recruiter = recruiterRes.rows[0] || {};
	const jobTitle = jobRes.rows[0]?.title || 'Unknown Position';

	const startTime = new Date(interview.scheduled_at);
	const endTime = new Date(startTime.getTime() + (interview.duration_minutes || 60) * 60000);

	const title = `Rekrut AI Interview — ${jobTitle}`;
	const description = `Interview for ${jobTitle} via Rekrut AI.\n\n${interview.meeting_link ? `Meeting Link: ${interview.meeting_link}\n` : ''}${interview.notes ? `Notes: ${interview.notes}\n` : ''}`;

	const attendees = [];
	if (candidate.email) attendees.push({ email: candidate.email, displayName: candidate.name || 'Candidate' });
	if (recruiter.email) attendees.push({ email: recruiter.email, displayName: recruiter.name || 'Recruiter' });

	return { title, description, startTime, endTime, attendees, candidate, recruiter };
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar Operations
// ─────────────────────────────────────────────────────────────────────────────

async function createGoogleEvent(connection, interview) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
	const payload = await buildEventPayload(interview);

	const event = {
		summary: payload.title,
		description: payload.description,
		start: { dateTime: payload.startTime.toISOString(), timeZone: 'UTC' },
		end: { dateTime: payload.endTime.toISOString(), timeZone: 'UTC' },
		attendees: payload.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
		reminders: {
			useDefault: false,
			overrides: [
				{ method: 'email', minutes: 60 },
				{ method: 'popup', minutes: 15 },
			],
		},
	};

	if (interview.meeting_link) {
		event.conferenceData = {
			createRequest: {
				requestId: `rekrut-${interview.id}-${Date.now()}`,
				conferenceSolutionKey: { type: 'hangoutsMeet' },
			},
		};
		event.location = interview.meeting_link;
	}

	const response = await calendar.events.insert({
		calendarId: conn.calendar_id || 'primary',
		resource: event,
		conferenceDataVersion: interview.meeting_link ? 1 : 0,
		sendUpdates: 'all',
	});

	return response.data.id;
}

async function updateGoogleEvent(connection, eventId, interview) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
	const payload = await buildEventPayload(interview);

	const event = {
		summary: payload.title,
		description: payload.description,
		start: { dateTime: payload.startTime.toISOString(), timeZone: 'UTC' },
		end: { dateTime: payload.endTime.toISOString(), timeZone: 'UTC' },
		attendees: payload.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
	};

	if (interview.meeting_link) {
		event.location = interview.meeting_link;
	}

	const response = await calendar.events.patch({
		calendarId: conn.calendar_id || 'primary',
		eventId,
		resource: event,
		sendUpdates: 'all',
	});

	return response.data.id;
}

async function deleteGoogleEvent(connection, eventId) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
	await calendar.events.delete({
		calendarId: conn.calendar_id || 'primary',
		eventId,
		sendUpdates: 'all',
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Outlook Calendar Operations (Microsoft Graph)
// ─────────────────────────────────────────────────────────────────────────────

async function createOutlookEvent(connection, interview) {
	const conn = await ensureFreshToken(connection);
	const payload = await buildEventPayload(interview);

	const eventBody = {
		subject: payload.title,
		body: {
			contentType: 'HTML',
			content: payload.description.replace(/\n/g, '<br>'),
		},
		start: {
			dateTime: payload.startTime.toISOString(),
			timeZone: 'UTC',
		},
		end: {
			dateTime: payload.endTime.toISOString(),
			timeZone: 'UTC',
		},
		attendees: payload.attendees.map((a) => ({
			emailAddress: { address: a.email, name: a.displayName },
			type: 'required',
		})),
		isOnlineMeeting: !!interview.meeting_link,
	};

	if (interview.meeting_link) {
		eventBody.location = { displayName: 'Virtual Interview', locationUri: interview.meeting_link };
	}

	const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${conn.access_token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(eventBody),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Outlook event creation failed: ${response.status} ${errText}`);
	}

	const data = await response.json();
	return data.id;
}

async function updateOutlookEvent(connection, eventId, interview) {
	const conn = await ensureFreshToken(connection);
	const payload = await buildEventPayload(interview);

	const eventBody = {
		subject: payload.title,
		body: {
			contentType: 'HTML',
			content: payload.description.replace(/\n/g, '<br>'),
		},
		start: {
			dateTime: payload.startTime.toISOString(),
			timeZone: 'UTC',
		},
		end: {
			dateTime: payload.endTime.toISOString(),
			timeZone: 'UTC',
		},
		attendees: payload.attendees.map((a) => ({
			emailAddress: { address: a.email, name: a.displayName },
			type: 'required',
		})),
	};

	if (interview.meeting_link) {
		eventBody.location = { displayName: 'Virtual Interview', locationUri: interview.meeting_link };
	}

	const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${conn.access_token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(eventBody),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Outlook event update failed: ${response.status} ${errText}`);
	}

	const data = await response.json();
	return data.id;
}

async function deleteOutlookEvent(connection, eventId) {
	const conn = await ensureFreshToken(connection);
	const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${conn.access_token}` },
	});

	if (!response.ok && response.status !== 404) {
		const errText = await response.text();
		throw new Error(`Outlook event deletion failed: ${response.status} ${errText}`);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic Event CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function createCalendarEvent(userId, provider, interview) {
	const connection = await getConnection(userId, provider);
	if (!connection) throw new Error(`No active ${provider} calendar connection for user ${userId}`);

	let eventId;
	if (provider === 'google') {
		eventId = await createGoogleEvent(connection, interview);
	} else if (provider === 'outlook') {
		eventId = await createOutlookEvent(connection, interview);
	} else {
		throw new Error(`Unsupported calendar provider: ${provider}`);
	}

	// Update interview record with calendar sync info
	await pool.query(
		`UPDATE scheduled_interviews SET calendar_event_id = $1, calendar_provider = $2, updated_at = NOW() WHERE id = $3`,
		[eventId, provider, interview.id],
	);

	return eventId;
}

async function updateCalendarEvent(userId, provider, eventId, interview) {
	const connection = await getConnection(userId, provider);
	if (!connection) throw new Error(`No active ${provider} calendar connection for user ${userId}`);

	if (provider === 'google') {
		await updateGoogleEvent(connection, eventId, interview);
	} else if (provider === 'outlook') {
		await updateOutlookEvent(connection, eventId, interview);
	} else {
		throw new Error(`Unsupported calendar provider: ${provider}`);
	}

	return eventId;
}

async function deleteCalendarEvent(userId, provider, eventId) {
	const connection = await getConnection(userId, provider);
	if (!connection) {
		console.warn(`[calendar-service] No active ${provider} connection for user ${userId}, skipping delete`);
		return;
	}

	if (provider === 'google') {
		await deleteGoogleEvent(connection, eventId);
	} else if (provider === 'outlook') {
		await deleteOutlookEvent(connection, eventId);
	} else {
		throw new Error(`Unsupported calendar provider: ${provider}`);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth URL Generation
// ─────────────────────────────────────────────────────────────────────────────

function getGoogleAuthUrl(state) {
	const oauth2Client = getGoogleClient();
	return oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: GOOGLE_SCOPES,
		prompt: 'consent',
		state,
	});
}

function getOutlookAuthUrl(state) {
	const client = getOutlookClient();
	return client.authorizeURL({
		redirect_uri: OUTLOOK_REDIRECT_URI,
		scope: OUTLOOK_SCOPES,
		state,
		prompt: 'consent',
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token Exchange
// ─────────────────────────────────────────────────────────────────────────────

async function exchangeGoogleCode(code) {
	const oauth2Client = getGoogleClient();
	const { tokens } = await oauth2Client.getToken(code);
	return tokens;
}

async function exchangeOutlookCode(code) {
	const client = getOutlookClient();
	const result = await client.getToken({
		code,
		redirect_uri: OUTLOOK_REDIRECT_URI,
		scope: OUTLOOK_SCOPES,
	});
	return result.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-sync helpers — used by interview routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to sync an interview to the recruiter's calendar.
 * Falls back to candidate's calendar if recruiter has none.
 * Non-blocking — catches errors internally.
 */
async function syncInterview(interview, operation = 'create') {
	try {
		// Prefer recruiter's calendar
		let userId = interview.recruiter_id;
		let provider = 'google';

		let connection = await getConnection(userId, provider);
		if (!connection) connection = await getConnection(userId, 'outlook');

		// Fallback to candidate's calendar
		if (!connection && interview.candidate_id) {
			userId = interview.candidate_id;
			connection = await getConnection(userId, 'google');
			if (!connection) connection = await getConnection(userId, 'outlook');
		}

		if (!connection) {
			console.log(`[calendar-sync] No calendar connection for interview ${interview.id}, skipping sync`);
			return null;
		}

		provider = connection.provider;

		if (operation === 'create') {
			return await createCalendarEvent(userId, provider, interview);
		}
		if (operation === 'update') {
			if (!interview.calendar_event_id || !interview.calendar_provider) {
				// No prior sync — create instead
				return await createCalendarEvent(userId, provider, interview);
			}
			return await updateCalendarEvent(userId, provider, interview.calendar_event_id, interview);
		}
		if (operation === 'delete') {
			if (!interview.calendar_event_id || !interview.calendar_provider) return null;
			await deleteCalendarEvent(userId, provider, interview.calendar_event_id);
			await pool.query(
				`UPDATE scheduled_interviews SET calendar_event_id = NULL, calendar_provider = NULL, updated_at = NOW() WHERE id = $1`,
				[interview.id],
			);
			return null;
		}
	} catch (err) {
		console.error('[calendar-sync] Auto-sync failed:', err.message);
		return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
	// OAuth helpers
	getGoogleAuthUrl,
	getOutlookAuthUrl,
	exchangeGoogleCode,
	exchangeOutlookCode,
	upsertConnection,
	getConnection,
	revokeConnection,

	// Event CRUD
	createCalendarEvent,
	updateCalendarEvent,
	deleteCalendarEvent,

	// Auto-sync
	syncInterview,
};
