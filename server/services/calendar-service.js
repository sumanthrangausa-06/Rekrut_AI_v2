const { google } = require('googleapis');
const { AuthorizationCode } = require('simple-oauth2');
const pool = require('../../lib/db');
const { encrypt, decrypt } = require('../../lib/crypto-utils');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_REDIRECT_URI =
	process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
	process.env.GOOGLE_REDIRECT_URI ||
	`${process.env.FRONTEND_URL || 'https://rekrut.ai'}/api/calendar/oauth/callback`;
const OUTLOOK_REDIRECT_URI =
	process.env.OUTLOOK_REDIRECT_URI ||
	`${process.env.FRONTEND_URL || 'https://rekrut.ai'}/api/calendar/oauth/callback`;

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
 * Access and refresh tokens are encrypted at rest using AES-256-GCM.
 */
async function upsertConnection(userId, provider, tokens, calendarId = 'primary') {
	const rawAccessToken = tokens.access_token || tokens.accessToken;
	const rawRefreshToken = tokens.refresh_token || tokens.refreshToken;
	const expiresAt = tokens.expiry_date
		? new Date(tokens.expiry_date)
		: tokens.expires_at
			? new Date(tokens.expires_at)
			: null;

	// Encrypt tokens at rest (AES-256-GCM)
	const accessToken = rawAccessToken ? encrypt(rawAccessToken) : null;
	const refreshToken = rawRefreshToken ? encrypt(rawRefreshToken) : null;

	await pool.query(
		`
    INSERT INTO calendar_connections (user_id, provider, access_token, refresh_token, expires_at, calendar_id, is_active, updated_at, encryption_version)
    VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), 'v1')
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
      expires_at = EXCLUDED.expires_at,
      calendar_id = EXCLUDED.calendar_id,
      is_active = true,
      updated_at = NOW(),
      encryption_version = 'v1'
  `,
		[userId, provider, accessToken, refreshToken, expiresAt, calendarId],
	);
}

/**
 * Get a user's active calendar connection for a provider.
 * Decrypts access_token and refresh_token before returning.
 */
async function getConnection(userId, provider) {
	const result = await pool.query(
		`SELECT * FROM calendar_connections WHERE user_id = $1 AND provider = $2 AND is_active = true`,
		[userId, provider],
	);
	const row = result.rows[0] || null;
	if (!row) return null;

	// Decrypt tokens for in-memory use (backward compat: passes through plaintext)
	try {
		if (row.access_token) row.access_token = decrypt(row.access_token);
		if (row.refresh_token) row.refresh_token = decrypt(row.refresh_token);
	} catch (err) {
		console.error(
			`[calendar-service] Failed to decrypt tokens for user ${userId} / ${provider}:`,
			err.message,
		);
		throw new Error('Calendar token decryption failed. Please reconnect your calendar.');
	}

	return row;
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
		return {
			...connection,
			access_token: credentials.access_token,
			expires_at: new Date(credentials.expiry_date),
		};
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
		return {
			...connection,
			access_token: token.access_token,
			expires_at: new Date(token.expires_at),
		};
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
 * Fetch user details (name, email) for a list of user IDs.
 */
async function getUserDetails(userIds) {
	if (!userIds || userIds.length === 0) return [];
	const result = await pool.query(`SELECT id, name, email FROM users WHERE id = ANY($1)`, [
		userIds,
	]);
	return result.rows;
}

/**
 * Build calendar event details from a scheduled_interview record.
 * Kept for backward compatibility with existing event CRUD functions.
 */
async function buildEventPayload(interview) {
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
	if (candidate.email)
		attendees.push({ email: candidate.email, displayName: candidate.name || 'Candidate' });
	if (recruiter.email)
		attendees.push({ email: recruiter.email, displayName: recruiter.name || 'Recruiter' });

	return { title, description, startTime, endTime, attendees, candidate, recruiter };
}

/**
 * Build calendar event payload from an interview_event record.
 * Supports multi-attendee (recruiter, candidate, panel members).
 */
async function buildInterviewEventPayload(event) {
	const userIds = [
		event.recruiter_id,
		event.candidate_id,
		...(event.panel_member_ids || []),
	].filter((v, i, a) => a.indexOf(v) === i);
	const users = await getUserDetails(userIds);
	const _userMap = new Map(users.map((u) => [u.id, u]));

	// Fetch job title via job_application -> job
	let jobTitle = 'Interview';
	try {
		const jobRes = await pool.query(
			`SELECT j.title
			 FROM job_applications ja
			 JOIN jobs j ON ja.job_id = j.id
			 WHERE ja.id = $1`,
			[event.job_application_id],
		);
		if (jobRes.rows[0]?.title) jobTitle = jobRes.rows[0].title;
	} catch (_e) {
		// ignore
	}

	const startTime = new Date(event.scheduled_at);
	const endTime = new Date(startTime.getTime() + (event.duration_minutes || 60) * 60000);

	const title = `Rekrut AI Interview — ${jobTitle}`;
	const description =
		`Interview for ${jobTitle} via Rekrut AI.\n\n` +
		`${event.meeting_link ? `Meeting Link: ${event.meeting_link}\n` : ''}` +
		`${event.livekit_room_url ? `LiveKit Room: ${event.livekit_room_url}\n` : ''}` +
		`${event.notes ? `Notes: ${event.notes}\n` : ''}`;

	const attendees = users
		.filter((u) => u.email)
		.map((u) => ({ email: u.email, displayName: u.name || 'Attendee', userId: u.id }));

	return { title, description, startTime, endTime, attendees, jobTitle };
}

/**
 * Create calendar events on ALL attendees' connected calendars.
 * Returns a JSONB-compatible object: { userId: externalEventId, ... }
 */
async function createMultiAttendeeEvents(event) {
	const payload = await buildInterviewEventPayload(event);
	const calendarEventIds = {};

	for (const attendee of payload.attendees) {
		if (!attendee.userId) continue;
		// Try Google first, then Outlook
		for (const provider of ['google', 'outlook']) {
			try {
				const conn = await getConnection(attendee.userId, provider);
				if (!conn) continue;

				let externalEventId;
				if (provider === 'google') {
					externalEventId = await _createGoogleEventForPayload(conn, payload);
				} else {
					externalEventId = await _createOutlookEventForPayload(conn, payload);
				}
				calendarEventIds[String(attendee.userId)] = externalEventId;
				break; // created on this attendee's calendar, move to next attendee
			} catch (err) {
				console.error(
					`[calendar-service] Failed to create ${provider} event for user ${attendee.userId}:`,
					err.message,
				);
				// continue to next provider or attendee
			}
		}
	}

	return calendarEventIds;
}

/**
 * Update calendar events on all attendees' connected calendars.
 * Uses calendar_event_ids JSONB to locate existing events.
 * Falls back to creating new events if an existing one can't be found.
 */
async function updateMultiAttendeeEvents(event) {
	const payload = await buildInterviewEventPayload(event);
	const existingIds = event.calendar_event_ids || {};
	const updatedIds = {};

	for (const attendee of payload.attendees) {
		if (!attendee.userId) continue;
		const userIdStr = String(attendee.userId);
		const existingEventId = existingIds[userIdStr];

		for (const provider of ['google', 'outlook']) {
			try {
				const conn = await getConnection(attendee.userId, provider);
				if (!conn) continue;

				let externalEventId;
				if (existingEventId) {
					// Try to update; if it fails (e.g. event deleted externally), create new
					try {
						if (provider === 'google') {
							await _updateGoogleEventForPayload(conn, existingEventId, payload);
						} else {
							await _updateOutlookEventForPayload(conn, existingEventId, payload);
						}
						externalEventId = existingEventId;
					} catch (updateErr) {
						console.warn(
							`[calendar-service] Update failed for user ${attendee.userId}, recreating:`,
							updateErr.message,
						);
						if (provider === 'google') {
							externalEventId = await _createGoogleEventForPayload(conn, payload);
						} else {
							externalEventId = await _createOutlookEventForPayload(conn, payload);
						}
					}
				} else {
					// No existing event for this attendee — create new
					if (provider === 'google') {
						externalEventId = await _createGoogleEventForPayload(conn, payload);
					} else {
						externalEventId = await _createOutlookEventForPayload(conn, payload);
					}
				}
				updatedIds[userIdStr] = externalEventId;
				break;
			} catch (err) {
				console.error(
					`[calendar-service] Failed to update ${provider} event for user ${attendee.userId}:`,
					err.message,
				);
			}
		}
	}

	return updatedIds;
}

/**
 * Delete calendar events from all attendees' connected calendars.
 */
async function deleteMultiAttendeeEvents(event) {
	const existingIds = event.calendar_event_ids || {};

	for (const [userIdStr, externalEventId] of Object.entries(existingIds)) {
		const userId = parseInt(userIdStr, 10);
		for (const provider of ['google', 'outlook']) {
			try {
				const conn = await getConnection(userId, provider);
				if (!conn) continue;

				if (provider === 'google') {
					await deleteGoogleEvent(conn, externalEventId);
				} else {
					await deleteOutlookEvent(conn, externalEventId);
				}
				break;
			} catch (err) {
				console.error(
					`[calendar-service] Failed to delete ${provider} event for user ${userId}:`,
					err.message,
				);
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level payload-based calendar operations (internal)
// ─────────────────────────────────────────────────────────────────────────────

async function _createGoogleEventForPayload(connection, payload) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));

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

	if (payload.meetingLink) {
		event.conferenceData = {
			createRequest: {
				requestId: `rekrut-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				conferenceSolutionKey: { type: 'hangoutsMeet' },
			},
		};
		event.location = payload.meetingLink;
	}

	const response = await calendar.events.insert({
		calendarId: conn.calendar_id || 'primary',
		resource: event,
		conferenceDataVersion: payload.meetingLink ? 1 : 0,
		sendUpdates: 'all',
	});

	return response.data.id;
}

async function _updateGoogleEventForPayload(connection, eventId, payload) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));

	const event = {
		summary: payload.title,
		description: payload.description,
		start: { dateTime: payload.startTime.toISOString(), timeZone: 'UTC' },
		end: { dateTime: payload.endTime.toISOString(), timeZone: 'UTC' },
		attendees: payload.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
	};

	if (payload.meetingLink) {
		event.location = payload.meetingLink;
	}

	const response = await calendar.events.patch({
		calendarId: conn.calendar_id || 'primary',
		eventId,
		resource: event,
		sendUpdates: 'all',
	});

	return response.data.id;
}

async function _createOutlookEventForPayload(connection, payload) {
	const conn = await ensureFreshToken(connection);

	const eventBody = {
		subject: payload.title,
		body: {
			contentType: 'HTML',
			content: payload.description.replace(/\n/g, '<br>'),
		},
		start: { dateTime: payload.startTime.toISOString(), timeZone: 'UTC' },
		end: { dateTime: payload.endTime.toISOString(), timeZone: 'UTC' },
		attendees: payload.attendees.map((a) => ({
			emailAddress: { address: a.email, name: a.displayName },
			type: 'required',
		})),
		isOnlineMeeting: !!payload.meetingLink,
	};

	if (payload.meetingLink) {
		eventBody.location = { displayName: 'Virtual Interview', locationUri: payload.meetingLink };
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

async function _updateOutlookEventForPayload(connection, eventId, payload) {
	const conn = await ensureFreshToken(connection);

	const eventBody = {
		subject: payload.title,
		body: {
			contentType: 'HTML',
			content: payload.description.replace(/\n/g, '<br>'),
		},
		start: { dateTime: payload.startTime.toISOString(), timeZone: 'UTC' },
		end: { dateTime: payload.endTime.toISOString(), timeZone: 'UTC' },
		attendees: payload.attendees.map((a) => ({
			emailAddress: { address: a.email, name: a.displayName },
			type: 'required',
		})),
	};

	if (payload.meetingLink) {
		eventBody.location = { displayName: 'Virtual Interview', locationUri: payload.meetingLink };
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

/**
 * Check availability for a set of user IDs across a date range.
 * Returns an array of busy intervals per user.
 * Note: This is a best-effort check. Users without calendar connections
 * are assumed to be free (no busy intervals returned).
 */
async function checkAvailability(userIds, timeMin, timeMax) {
	const availability = {};

	for (const userId of userIds) {
		availability[String(userId)] = [];
		for (const provider of ['google', 'outlook']) {
			try {
				const conn = await getConnection(userId, provider);
				if (!conn) continue;

				if (provider === 'google') {
					const busy = await _getGoogleAvailability(conn, timeMin, timeMax);
					availability[String(userId)].push(...busy);
				} else {
					const busy = await _getOutlookAvailability(conn, timeMin, timeMax);
					availability[String(userId)].push(...busy);
				}
				break; // got availability from one provider, move to next user
			} catch (err) {
				console.error(
					`[calendar-service] Availability check failed for user ${userId} / ${provider}:`,
					err.message,
				);
			}
		}
	}

	return availability;
}

async function _getGoogleAvailability(connection, timeMin, timeMax) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));
	const response = await calendar.freebusy.query({
		requestBody: {
			timeMin: new Date(timeMin).toISOString(),
			timeMax: new Date(timeMax).toISOString(),
			timeZone: 'UTC',
			items: [{ id: conn.calendar_id || 'primary' }],
		},
	});

	const busy = response.data.calendars[conn.calendar_id || 'primary']?.busy || [];
	return busy.map((b) => ({ start: b.start, end: b.end }));
}

async function _getOutlookAvailability(connection, timeMin, timeMax) {
	const conn = await ensureFreshToken(connection);
	const startIso = new Date(timeMin).toISOString();
	const endIso = new Date(timeMax).toISOString();

	// Microsoft Graph calendarView endpoint
	const url =
		`https://graph.microsoft.com/v1.0/me/calendar/calendarView?` +
		`startDateTime=${encodeURIComponent(startIso)}&` +
		`endDateTime=${encodeURIComponent(endIso)}&` +
		`$select=start,end,showAs`;

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${conn.access_token}` },
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Outlook availability failed: ${response.status} ${errText}`);
	}

	const data = await response.json();
	return (data.value || [])
		.filter((evt) => evt.showAs !== 'free')
		.map((evt) => ({ start: evt.start.dateTime, end: evt.end.dateTime }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar Operations
// ─────────────────────────────────────────────────────────────────────────────

async function createGoogleEvent(connection, interview) {
	const conn = await ensureFreshToken(connection);
	const oauth2Client = getGoogleClient();
	oauth2Client.setCredentials({ access_token: conn.access_token });

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));
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

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));
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

	const calendar = /** @type {any} */ (google.calendar({ version: 'v3', auth: oauth2Client }));
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
		console.warn(
			`[calendar-service] No active ${provider} connection for user ${userId}, skipping delete`,
		);
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
			console.log(
				`[calendar-sync] No calendar connection for interview ${interview.id}, skipping sync`,
			);
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

	// Multi-attendee event management (Issue #127)
	createMultiAttendeeEvents,
	updateMultiAttendeeEvents,
	deleteMultiAttendeeEvents,
	checkAvailability,

	// Auto-sync
	syncInterview,
};
