// =============================================================================
// LiveKit Service — Token generation & room management (Issue #124)
// =============================================================================
//
// Handles:
//   - Access token generation for interview participants
//   - Room creation / deletion via LiveKit Server API
//   - Room validation against local interview_rooms records
//
// Requires env vars: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
// =============================================================================

const pool = require('../../lib/db');

// LiveKit SDK v2 is ESM-only; lazy-load via dynamic import
/** @type {any} */
let _livekitModule = null;

async function getLivekitModule() {
	if (!_livekitModule) {
		_livekitModule = await import('livekit-server-sdk');
	}
	return _livekitModule;
}

function getConfig() {
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;
	const livekitUrl = process.env.LIVEKIT_URL;

	if (!apiKey || !apiSecret || !livekitUrl) {
		throw new Error('LiveKit not configured: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL required');
	}
	return { apiKey, apiSecret, livekitUrl };
}

// ─── Token Generation ───────────────────────────────────────────────────────

/**
 * Generate a LiveKit access token for a participant.
 * @param {Object} opts
 * @param {string} opts.identity - unique participant identity (user id)
 * @param {string} opts.name - display name
 * @param {string} opts.roomName - LiveKit room name
 * @param {number} [opts.ttlMs=3600000] - token TTL in ms (default 1 hour)
 * @returns {Promise<string>} JWT token
 */
async function generateToken({ identity, name, roomName, ttlMs = 60 * 60 * 1000 }) {
	const { AccessToken } = await getLivekitModule();
	const { apiKey, apiSecret } = getConfig();

	const token = new AccessToken(apiKey, apiSecret, {
		identity: String(identity),
		name: name || String(identity),
		ttl: ttlMs,
	});

	token.addGrant({
		roomJoin: true,
		room: roomName,
		canPublish: true,
		canSubscribe: true,
		canPublishData: true,
	});

	return token.toJwt();
}

// ─── Room Management ────────────────────────────────────────────────────────

function getRoomClient() {
	const { RoomServiceClient } = require('livekit-server-sdk');
	const { apiKey, apiSecret, livekitUrl } = getConfig();
	// RoomServiceClient expects the LiveKit host URL (ws:// or wss://) stripped to http/s
	const httpUrl = livekitUrl.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '');
	return new RoomServiceClient(httpUrl, apiKey, apiSecret);
}

/**
 * Create a LiveKit room on the server.
 * @param {string} roomName
 * @param {Object} [options]
 * @param {number} [options.emptyTimeout=300] - seconds before empty room is deleted
 * @param {number} [options.maxParticipants=10]
 * @returns {Promise<{name: string, sid: string, creationTime: Date}>}
 */
async function createRoom(roomName, options = {}) {
	const { apiKey, apiSecret } = getConfig();
	const { RoomServiceClient } = await getLivekitModule();

	const httpUrl = process.env.LIVEKIT_URL.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '');
	const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);

	const room = await client.createRoom({
		name: roomName,
		emptyTimeout: options.emptyTimeout ?? 300,
		maxParticipants: options.maxParticipants ?? 10,
	});

	return room;
}

/**
 * Delete a LiveKit room from the server.
 * @param {string} roomName
 */
async function deleteRoom(roomName) {
	const { apiKey, apiSecret } = getConfig();
	const { RoomServiceClient } = await getLivekitModule();

	const httpUrl = process.env.LIVEKIT_URL.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '');
	const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);

	await client.deleteRoom(roomName);
}

// ─── Database Integration ───────────────────────────────────────────────────

/**
 * Persist a new interview room record.
 * @param {Object} opts
 * @param {number} opts.interviewEventId
 * @param {string} opts.roomName
 * @param {string} opts.livekitRoomId
 * @returns {Promise<Object>} inserted row
 */
async function createRoomRecord({ interviewEventId, roomName, livekitRoomId }) {
	const result = await pool.query(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status, created_at)
     VALUES ($1, $2, $3, 'active', NOW())
     RETURNING *`,
		[interviewEventId, roomName, livekitRoomId],
	);
	return result.rows[0];
}

/**
 * Mark a room as closed in the database.
 * @param {number} roomId
 */
async function closeRoomRecord(roomId) {
	await pool.query(
		`UPDATE interview_rooms
     SET status = 'closed', closed_at = NOW()
     WHERE id = $1`,
		[roomId],
	);
}

/**
 * Find an active room by interview event ID.
 * @param {number} interviewEventId
 * @returns {Promise<Object|null>}
 */
async function findActiveRoomByInterviewEventId(interviewEventId) {
	const result = await pool.query(
		`SELECT * FROM interview_rooms
     WHERE interview_event_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
		[interviewEventId],
	);
	return result.rows[0] || null;
}

/**
 * Find a room by its local record ID.
 * @param {number} roomId
 * @returns {Promise<Object|null>}
 */
async function findRoomById(roomId) {
	const result = await pool.query(
		`SELECT * FROM interview_rooms WHERE id = $1`,
		[roomId],
	);
	return result.rows[0] || null;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Verify that a user is a participant in the interview event linked to a room.
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<{isParticipant: boolean, role: string|null, event: Object|null}>}
 */
async function validateRoomAccess(roomId, userId) {
	const room = await findRoomById(roomId);
	if (!room) return { isParticipant: false, role: null, event: null };

	const eventRes = await pool.query(
		`SELECT * FROM interview_events WHERE id = $1`,
		[room.interview_event_id],
	);
	const event = eventRes.rows[0] || null;
	if (!event) return { isParticipant: false, role: null, event: null };

	const isRecruiter = event.recruiter_id === userId;
	const isCandidate = event.candidate_id === userId;
	const isPanel = (event.panel_member_ids || []).includes(userId);

	if (isRecruiter) return { isParticipant: true, role: 'recruiter', event };
	if (isCandidate) return { isParticipant: true, role: 'candidate', event };
	if (isPanel) return { isParticipant: true, role: 'panel', event };

	return { isParticipant: false, role: null, event };
}

// ─── Auto-create on Interview Schedule ──────────────────────────────────────

/**
 * Automatically create a LiveKit room when an interview is confirmed.
 * Idempotent — returns existing active room if one already exists.
 * @param {number} interviewEventId
 * @returns {Promise<Object|null>} room record or null if LiveKit not configured
 */
async function autoCreateRoomForInterview(interviewEventId) {
	try {
		getConfig();
	} catch (_e) {
		console.warn('[livekit] Skipping room auto-create: LiveKit not configured');
		return null;
	}

	// Check for existing active room
	const existing = await findActiveRoomByInterviewEventId(interviewEventId);
	if (existing) return existing;

	const eventRes = await pool.query(
		`SELECT * FROM interview_events WHERE id = $1`,
		[interviewEventId],
	);
	const event = eventRes.rows[0];
	if (!event) {
		console.warn(`[livekit] Interview event ${interviewEventId} not found, skipping room creation`);
		return null;
	}

	// Generate a deterministic but unique room name
	const roomName = `rekrut-${interviewEventId}-${Date.now()}`;

	try {
		const livekitRoom = await createRoom(roomName, {
			emptyTimeout: 600, // 10 minutes
			maxParticipants: 10,
		});

		const record = await createRoomRecord({
			interviewEventId,
			roomName: livekitRoom.name,
			livekitRoomId: livekitRoom.sid,
		});

		// Update interview_events with room URL for frontend convenience
		const livekitUrl = `${process.env.LIVEKIT_URL.replace(/\/$/, '')}/${roomName}`;
		await pool.query(
			`UPDATE interview_events SET livekit_room_url = $1, updated_at = NOW() WHERE id = $2`,
			[livekitUrl, interviewEventId],
		);

		console.log(`[livekit] Room created for interview ${interviewEventId}: ${roomName}`);
		return record;
	} catch (err) {
		console.error(`[livekit] Failed to create room for interview ${interviewEventId}:`, err.message);
		// Non-blocking: don't fail the interview scheduling if LiveKit is down
		return null;
	}
}

module.exports = {
	generateToken,
	createRoom,
	deleteRoom,
	createRoomRecord,
	closeRoomRecord,
	findActiveRoomByInterviewEventId,
	findRoomById,
	validateRoomAccess,
	autoCreateRoomForInterview,
};
