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
const encryption = require('../../services/encryption');

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
		throw new Error(
			'LiveKit not configured: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL required',
		);
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

function _getRoomClient() {
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
	const result = await pool.query(`SELECT * FROM interview_rooms WHERE id = $1`, [roomId]);
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

	const eventRes = await pool.query(`SELECT * FROM interview_events WHERE id = $1`, [
		room.interview_event_id,
	]);
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

	const eventRes = await pool.query(`SELECT * FROM interview_events WHERE id = $1`, [
		interviewEventId,
	]);
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
		console.error(
			`[livekit] Failed to create room for interview ${interviewEventId}:`,
			err.message,
		);
		// Non-blocking: don't fail the interview scheduling if LiveKit is down
		return null;
	}
}

// ─── Egress Recording (Issue #126) ────────────────────────────────────────

/**
 * Get an EgressClient for room composition recording.
 * LiveKit Egress uses the same API credentials but a different endpoint.
 */
async function getEgressClient() {
	const { EgressClient } = await getLivekitModule();
	const { apiKey, apiSecret } = getConfig();
	const httpUrl = process.env.LIVEKIT_URL.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '');
	return new EgressClient(httpUrl, apiKey, apiSecret);
}

/**
 * Build S3 output config for LiveKit Egress from environment.
 * Supports AWS S3, Cloudflare R2, or any S3-compatible storage.
 * @returns {Object|null} S3 upload configuration or null if not configured
 */
function getS3OutputConfig() {
	const bucket = process.env.RECORDING_STORAGE_BUCKET;
	const region = process.env.RECORDING_STORAGE_REGION || 'auto';
	const endpoint = process.env.RECORDING_STORAGE_ENDPOINT;
	const accessKey = process.env.RECORDING_STORAGE_ACCESS_KEY;
	const secretKey = process.env.RECORDING_STORAGE_SECRET_KEY;

	if (!bucket || !accessKey || !secretKey) {
		return null;
	}

	return {
		S3: {
			bucket,
			region,
			endpoint,
			accessKey,
			secret: secretKey,
		},
	};
}

/**
 * Start a room composition recording via LiveKit Egress.
 * @param {string} roomName - LiveKit room name
 * @param {Object} [options]
 * @param {string} [options.fileType='mp4'] - Output format (mp4 or ogg)
 * @param {string} [options.resolution='720p'] - Video resolution
 * @param {boolean} [options.audioOnly=false] - Audio-only recording
 * @returns {Promise<{egressId: string, status: string, fileLocation?: string}>}
 */
async function startRoomRecording(roomName, options = {}) {
	const client = await getEgressClient();
	const s3Config = getS3OutputConfig();

	if (!s3Config) {
		throw new Error(
			'Recording storage not configured: RECORDING_STORAGE_BUCKET, RECORDING_STORAGE_ACCESS_KEY, RECORDING_STORAGE_SECRET_KEY required',
		);
	}

	const { RoomCompositeEgressRequest, EncodedFileType } = await getLivekitModule();

	const fileType = options.fileType === 'ogg' ? EncodedFileType.OGG : EncodedFileType.MP4;
	const req = new RoomCompositeEgressRequest({
		roomName,
		fileType,
		preset: options.resolution === '1080p' ? 'H264_1080P_30' : 'H264_720P_30',
		audioOnly: options.audioOnly || false,
	});

	// Attach S3 output
	req.fileOutputs = [
		{
			fileType,
			filepath: `rekrut-recordings/${roomName}-${Date.now()}.${fileType === EncodedFileType.OGG ? 'ogg' : 'mp4'}`,
			...s3Config,
		},
	];

	const info = await client.startRoomCompositeEgress(roomName, req);

	return {
		egressId: info.egressId,
		status: info.status,
		fileLocation: info.fileResults?.[0]?.location || null,
	};
}

/**
 * Stop an active Egress recording.
 * @param {string} egressId
 * @returns {Promise<{egressId: string, status: string}>}
 */
async function stopRoomRecording(egressId) {
	const client = await getEgressClient();
	const info = await client.stopEgress(egressId);
	return {
		egressId: info.egressId,
		status: info.status,
	};
}

/**
 * Get the current status of an Egress recording.
 * @param {string} egressId
 * @returns {Promise<Object|null>}
 */
async function getEgressInfo(egressId) {
	const client = await getEgressClient();
	const info = await client.listEgress({ egressId });
	return info?.[0] || null;
}

// ─── Recording Database Operations ────────────────────────────────────────

/**
 * Persist a new recording record.
 * @param {Object} opts
 * @param {number} opts.interviewEventId
 * @param {number} opts.roomId
 * @param {string} opts.egressId
 * @returns {Promise<Object>} inserted row
 */
async function createRecordingRecord({ interviewEventId, roomId, egressId }) {
	const retentionDays = parseInt(process.env.RECORDING_RETENTION_DAYS || '90', 10);
	const retentionDate = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
	const result = await pool.query(
		`INSERT INTO interview_recordings
		 (interview_event_id, room_id, livekit_egress_id, status, started_at, retention_expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, 'recording', NOW(), $4, NOW(), NOW())
		 RETURNING *`,
		[interviewEventId, roomId, egressId, retentionDate],
	);
	return result.rows[0];
}

/**
 * Mark a recording as stopped and store the encrypted file path.
 * @param {number} recordingId
 * @param {string} storagePath - raw S3/R2 path or URL
 * @param {number} durationSeconds
 * @param {number} fileSizeBytes
 */
async function completeRecordingRecord(recordingId, storagePath, durationSeconds, fileSizeBytes) {
	const encryptedPath = storagePath ? encryption.encrypt(Buffer.from(storagePath)) : null;
	await pool.query(
		`UPDATE interview_recordings
		 SET status = 'completed',
		     stopped_at = NOW(),
		     duration_seconds = $1,
		     storage_path = $2,
		     file_size_bytes = $3,
		     updated_at = NOW()
		 WHERE id = $4`,
		[durationSeconds, encryptedPath, fileSizeBytes, recordingId],
	);
}

/**
 * Mark a recording as failed.
 * @param {number} recordingId
 * @param {string} [reason]
 */
async function failRecordingRecord(recordingId, _reason) {
	await pool.query(
		`UPDATE interview_recordings
		 SET status = 'failed',
		     stopped_at = NOW(),
		     updated_at = NOW()
		 WHERE id = $1`,
		[recordingId],
	);
}

/**
 * Find a recording by its local record ID.
 * @param {number} recordingId
 * @returns {Promise<Object|null>}
 */
async function findRecordingById(recordingId) {
	const result = await pool.query(`SELECT * FROM interview_recordings WHERE id = $1`, [
		recordingId,
	]);
	return result.rows[0] || null;
}

/**
 * Find the active recording for a room.
 * @param {number} roomId
 * @returns {Promise<Object|null>}
 */
async function findActiveRecordingByRoomId(roomId) {
	const result = await pool.query(
		`SELECT * FROM interview_recordings
		 WHERE room_id = $1 AND status = 'recording'
		 ORDER BY started_at DESC
		 LIMIT 1`,
		[roomId],
	);
	return result.rows[0] || null;
}

/**
 * List recordings for an interview event.
 * @param {number} interviewEventId
 * @returns {Promise<Object[]>}
 */
async function listRecordingsByEventId(interviewEventId) {
	const result = await pool.query(
		`SELECT * FROM interview_recordings
		 WHERE interview_event_id = $1
		 ORDER BY created_at DESC`,
		[interviewEventId],
	);
	return result.rows;
}

/**
 * Decrypt the storage path for a recording.
 * @param {Object} recording - interview_recordings row
 * @returns {string|null}
 */
function decryptStoragePath(recording) {
	if (!recording.storage_path) return null;
	try {
		const decrypted = encryption.decrypt(Buffer.from(recording.storage_path));
		return decrypted.toString('utf-8');
	} catch (err) {
		console.error('[livekit] Failed to decrypt storage path:', err.message);
		return null;
	}
}

// ─── Audio Download for Transcription ─────────────────────────────────────

/**
 * Download audio from a recording storage path for transcription.
 * @param {string} storagePath - decrypted S3/R2 path
 * @returns {Promise<Buffer|null>}
 */
async function downloadRecordingAudio(storagePath) {
	try {
		// If it's an HTTP URL, fetch it directly
		if (storagePath.startsWith('http')) {
			const res = await fetch(storagePath);
			if (!res.ok) {
				console.error(`[livekit] Download failed: ${res.status} ${res.statusText}`);
				return null;
			}
			return Buffer.from(await res.arrayBuffer());
		}

		// For S3 paths, construct a pre-signed URL or use the R2 proxy
		const endpoint = process.env.RECORDING_STORAGE_ENDPOINT;
		const bucket = process.env.RECORDING_STORAGE_BUCKET;
		if (endpoint && bucket) {
			const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${storagePath}`;
			const res = await fetch(url);
			if (!res.ok) {
				console.error(`[livekit] Download failed: ${res.status} ${res.statusText}`);
				return null;
			}
			return Buffer.from(await res.arrayBuffer());
		}

		return null;
	} catch (err) {
		console.error('[livekit] Download recording audio error:', err.message);
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
	// Issue #126 — Recording
	startRoomRecording,
	stopRoomRecording,
	getEgressInfo,
	createRecordingRecord,
	completeRecordingRecord,
	failRecordingRecord,
	findRecordingById,
	findActiveRecordingByRoomId,
	listRecordingsByEventId,
	decryptStoragePath,
	downloadRecordingAudio,
};
