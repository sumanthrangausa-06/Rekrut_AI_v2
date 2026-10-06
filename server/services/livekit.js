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
	// Static require (not dynamic import): the SDK ships a CJS build and the
	// rest of this module already requires it statically (RoomServiceClient,
	// AgentDispatchClient). Dynamic import() cannot run under this repo's
	// jest setup (no --experimental-vm-modules), which made the egress path
	// untestable — see Task 6 (#323).
	if (!_livekitModule) {
		_livekitModule = require('livekit-server-sdk');
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
 * @param {Object} [opts.grants] - grant overrides (default: full participant grants)
 * @returns {Promise<string>} JWT token
 */
async function generateToken({ identity, name, roomName, ttlMs = 60 * 60 * 1000, grants = {} }) {
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
		...grants,
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

// ─── Session-linked rooms (Issue #323) ──────────────────────────────────────
// Phase 2 keys LiveKit rooms to the unified interview_sessions model. A room
// is linked to EITHER an interview_event (legacy, migration 127) OR an
// interview_session (migration 139) — never both.

/**
 * Find the active room linked to an interview session.
 * @param {number} sessionId
 * @returns {Promise<Object|null>}
 */
async function findActiveRoomBySessionId(sessionId) {
	const result = await pool.query(
		`SELECT * FROM interview_rooms
     WHERE interview_session_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
		[sessionId],
	);
	return result.rows[0] || null;
}

/**
 * Persist a session-linked room record.
 * @param {Object} opts
 * @param {number} opts.sessionId
 * @param {string} opts.roomName
 * @param {string} opts.livekitRoomId
 */
async function createSessionRoomRecord({ sessionId, roomName, livekitRoomId }) {
	const result = await pool.query(
		`INSERT INTO interview_rooms (interview_event_id, interview_session_id, room_name, livekit_room_id, status, created_at)
     VALUES (NULL, $1, $2, $3, 'active', NOW())
     RETURNING *`,
		[sessionId, roomName, livekitRoomId],
	);
	return result.rows[0];
}

/**
 * Get the active room for a session, creating it on the LiveKit server if
 * none exists. Idempotent under sequential calls — a second call reuses the
 * active room instead of creating another one.
 * @param {number} sessionId
 * @returns {Promise<Object>} the interview_rooms row
 */
async function findOrCreateSessionRoom(sessionId) {
	const existing = await findActiveRoomBySessionId(sessionId);
	if (existing) return existing;

	const roomName = `interview-${sessionId}`;
	const livekitRoom = await createRoom(roomName, {
		emptyTimeout: 600, // 10 minutes
		maxParticipants: 10,
	});

	return createSessionRoomRecord({
		sessionId,
		roomName: livekitRoom.name,
		livekitRoomId: livekitRoom.sid,
	});
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

// ─── Voice Agent Dispatch (Issue #323) ───────────────────────────────────────
// The voice agent worker itself is Task 3. This only dispatches a registered
// agent to the session's room via the LiveKit Cloud Agent Dispatch API,
// passing { interview_session_id, mode } as dispatch metadata. Idempotent per
// session+mode: LiveKit is the source of truth (listDispatch), so a dispatch
// deleted server-side is not treated as still active.

const DISPATCH_MODES = ['interviewer', 'observer'];

/**
 * The registered LiveKit agent name to dispatch. Task 3's agent worker must
 * register under this name (override via LIVEKIT_AGENT_NAME if it differs).
 * @returns {string}
 */
function getVoiceAgentName() {
	return process.env.LIVEKIT_AGENT_NAME || 'rekrut-interviewer';
}

function _getAgentDispatchClient() {
	const { AgentDispatchClient } = require('livekit-server-sdk');
	const { apiKey, apiSecret, livekitUrl } = getConfig();
	// AgentDispatchClient expects the LiveKit host URL (ws:// or wss://) stripped to http/s
	const httpUrl = livekitUrl.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '');
	return new AgentDispatchClient(httpUrl, apiKey, apiSecret);
}

/**
 * True when a LiveKit dispatch record is one of ours (matching mode metadata
 * AND the session it was dispatched for) and has not been deleted.
 * Unparseable metadata is never ours.
 * @param {Object} dispatch - livekit AgentDispatch
 * @param {string} mode - 'interviewer' | 'observer'
 * @param {number|string} sessionId - interview session the dispatch belongs to
 * @returns {boolean}
 */
function _isActiveDispatchForMode(dispatch, mode, sessionId) {
	if (!dispatch) return false;
	const deletedAt = dispatch.state?.deletedAt;
	if (deletedAt != null && Number(deletedAt) > 0) return false;
	try {
		const meta = JSON.parse(dispatch.metadata || '{}');
		if (meta.mode !== mode) return false;
		return meta.interview_session_id === Number(sessionId);
	} catch {
		return false;
	}
}

/**
 * Dispatch the voice agent to an already-provisioned session room. Narrow
 * SDK-only unit: given the room row, it checks LiveKit for an existing active
 * dispatch with matching mode metadata (idempotent per session+mode) and
 * creates one if none exists.
 * @param {Object} room - interview_rooms row (must have room_name)
 * @param {number} sessionId
 * @param {string} mode - 'interviewer' (Track A) | 'observer' (Track B)
 * @returns {Promise<{dispatched?: boolean, already_dispatched?: boolean, dispatch_id?: string, room: Object}>}
 */
async function dispatchAgentToRoom(room, sessionId, mode) {
	const client = _getAgentDispatchClient();

	const existing = await client.listDispatch(room.room_name);
	if (existing.some((d) => _isActiveDispatchForMode(d, mode, sessionId))) {
		return { already_dispatched: true, room };
	}

	const metadata = JSON.stringify({ interview_session_id: Number(sessionId), mode });
	const dispatch = await client.createDispatch(room.room_name, getVoiceAgentName(), {
		metadata,
	});
	return { dispatched: true, dispatch_id: dispatch.id, room };
}

/**
 * Dispatch the voice agent to a session's LiveKit room. Idempotent per
 * session+mode — a second call with the same mode returns
 * { already_dispatched: true } without creating another dispatch.
 *
 * An in-flight map closes the check-then-act race in dispatchAgentToRoom:
 * two concurrent calls for the same session+mode share one pending dispatch
 * promise instead of both seeing an empty listDispatch and creating two
 * agents. The entry is deleted in `finally`, so a failed dispatch does not
 * poison later calls (they retry). This covers same-process races; cross-
 * process races remain deduped by the listDispatch check on the next call.
 * @param {number} sessionId
 * @param {string} [mode='interviewer'] - 'interviewer' (Track A) | 'observer' (Track B)
 * @returns {Promise<{dispatched?: boolean, already_dispatched?: boolean, dispatch_id?: string, room: Object}>}
 */
const inFlightDispatches = new Map();

async function dispatchVoiceAgent(sessionId, mode = 'interviewer') {
	if (!DISPATCH_MODES.includes(mode)) {
		throw new Error(`Invalid dispatch mode: ${mode}`);
	}
	const key = `${sessionId}:${mode}`;
	const inFlight = inFlightDispatches.get(key);
	if (inFlight) return inFlight;
	const promise = (async () => {
		const room = await findOrCreateSessionRoom(sessionId);
		return dispatchAgentToRoom(room, sessionId, mode);
	})().finally(() => {
		inFlightDispatches.delete(key);
	});
	inFlightDispatches.set(key, promise);
	return promise;
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
 * @returns {Promise<{egressId: string, status: string, fileResults: Array}>}
 */
async function stopRoomRecording(egressId) {
	const client = await getEgressClient();
	const info = await client.stopEgress(egressId);
	return {
		egressId: info.egressId,
		status: info.status,
		// I2 (#323): surface the file results — the stop response is the
		// only source of the final R2 file location and duration.
		fileResults: info.fileResults || [],
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

// ─── Session Egress Recording (Issue #323, Task 6) ─────────────────────────
// Phase 2 sessions record the LiveKit ROOM composite (Track A: candidate +
// agent; Track B: both humans — the muted observer's subscription produces
// no media of its own). The egress lifecycle is tied to the session:
// started when the voice session goes live (dispatch), stopped when the
// session completes or consent is withdrawn.

/** Egress statuses after which a new egress may be started. */
const TERMINAL_EGRESS_STATUSES = new Set([
	'EGRESS_COMPLETE',
	'EGRESS_ENDING',
	'EGRESS_FAILED',
	'EGRESS_ABORTED',
	'EGRESS_LIMIT_REACHED',
]);

/**
 * Start room-composite egress for a session's LiveKit room and link it to
 * the session's recording row. Idempotent: an already-active egress is
 * returned, not duplicated.
 * Consent-gated on the candidate (spec §5: no capture before explicit
 * consent) — mirrors the Phase 1 frame-capture gate (403 CONSENT_REQUIRED).
 * @param {number} sessionId
 * @param {Object} [opts]
 * @param {number} [opts.consentUserId] - user whose consent is required; when
 *   omitted the gate is skipped (caller already gated).
 * @returns {Promise<{egressId: string, recording?: Object, already_started?: boolean}>}
 */
async function startSessionEgress(sessionId, { consentUserId } = {}) {
	let recording = await findRecordingBySessionId(sessionId);
	if (!recording) {
		recording = await createRecordingRecord({ interviewSessionId: sessionId, status: 'pending' });
	}
	if (consentUserId != null && !(await hasActiveConsent(recording.id, consentUserId))) {
		const err = new Error('Recording consent required');
		err.status = 403;
		err.code = 'CONSENT_REQUIRED';
		throw err;
	}
	if (recording.livekit_egress_id) {
		const info = await getEgressInfo(recording.livekit_egress_id).catch(() => null);
		if (info && !TERMINAL_EGRESS_STATUSES.has(info.status)) {
			return { already_started: true, egressId: recording.livekit_egress_id };
		}
	}
	const room = await findActiveRoomBySessionId(sessionId);
	if (!room) {
		throw new Error(`No active LiveKit room for session ${sessionId}`);
	}
	const egress = await startRoomRecording(room.room_name);
	const updated = await pool.query(
		`UPDATE interview_recordings
		    SET livekit_egress_id = $1, status = 'recording',
		        started_at = COALESCE(started_at, NOW()), updated_at = NOW()
		  WHERE id = $2 RETURNING *`,
		[egress.egressId, recording.id],
	);
	return { egressId: egress.egressId, recording: updated.rows[0] };
}

/**
 * Stop a session's room egress (best-effort). Never throws: an egress that
 * is already complete/aborted is reported, not raised — callers treat the
 * stop as non-blocking.
 * @param {number} sessionId
 * @returns {Promise<{egressId: string, status: string, fileLocation?: string, durationSeconds?: number, fileSizeBytes?: number, error?: string}|null>}
 */
async function stopSessionEgress(sessionId) {
	const recording = await findRecordingBySessionId(sessionId);
	if (!recording?.livekit_egress_id) return null;
	try {
		const info = await stopRoomRecording(recording.livekit_egress_id);
		// I2 (#323): FileInfo.duration is int64 nanoseconds; the recordings
		// table stores seconds.
		const file = (info.fileResults || [])[0] || null;
		return {
			egressId: recording.livekit_egress_id,
			status: info.status,
			fileLocation: file?.location || null,
			durationSeconds: file?.duration != null ? Math.round(Number(file.duration) / 1e9) : null,
			fileSizeBytes: file?.size != null ? Number(file.size) : null,
		};
	} catch (err) {
		console.error('[livekit] stopSessionEgress failed:', err.message);
		return { egressId: recording.livekit_egress_id, status: 'unknown', error: err.message };
	}
}

// ─── Recording Database Operations ────────────────────────────────────────

/**
 * Phase 1 retention policy for recordings (#322): RECORDING_RETENTION_DAYS
 * (default 90) from now. Shared by createRecordingRecord and the Task 6
 * session-finalize path — one formula, no drift.
 * @param {number} [retentionDays] - overrides RECORDING_RETENTION_DAYS.
 * @returns {Date}
 */
function getRecordingRetentionDate(retentionDays) {
	const days = retentionDays ?? parseInt(process.env.RECORDING_RETENTION_DAYS || '90', 10);
	return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Persist a new recording record.
 * @param {Object} opts
 * @param {number} [opts.interviewEventId] - LiveKit flow (interview_events.id)
 * @param {number} [opts.roomId] - LiveKit flow (interview_rooms.id)
 * @param {string} [opts.egressId] - LiveKit egress id (LiveKit flow only)
 * @param {number} [opts.interviewSessionId] - Phase 1 unified sessions (#322):
 *   session-linked recordings have no event/room; exactly one of
 *   interviewEventId / interviewSessionId must be set (migration 130).
 * @param {string} [opts.status] - defaults to 'recording' (LiveKit flow);
 *   session recordings start as 'pending' until capture begins.
 * @param {number} [opts.retentionDays] - overrides RECORDING_RETENTION_DAYS.
 * @returns {Promise<Object>} inserted row
 */
async function createRecordingRecord({
	interviewEventId,
	roomId,
	egressId,
	interviewSessionId,
	status = 'recording',
	retentionDays,
}) {
	const retentionDate = getRecordingRetentionDate(retentionDays);
	const result = await pool.query(
		`INSERT INTO interview_recordings
		 (interview_event_id, room_id, interview_session_id, livekit_egress_id, status, started_at, retention_expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW(), NOW())
		 RETURNING *`,
		[
			interviewEventId || null,
			roomId || null,
			interviewSessionId || null,
			egressId || null,
			status,
			retentionDate,
		],
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
 * Find the latest recording for a unified interview session (#322).
 * @param {number} interviewSessionId
 * @returns {Promise<Object|null>}
 */
async function findRecordingBySessionId(interviewSessionId) {
	const result = await pool.query(
		`SELECT * FROM interview_recordings
		 WHERE interview_session_id = $1
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[interviewSessionId],
	);
	return result.rows[0] || null;
}

/**
 * Whether the user has active (non-withdrawn) recording consent.
 * Capture requires a consent row to exist AND not be withdrawn (#322, Task 4):
 * missing consent blocks capture just like withdrawn consent does.
 * @param {number} recordingId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function hasActiveConsent(recordingId, userId) {
	const result = await pool.query(
		`SELECT consent_type FROM recording_consent WHERE recording_id = $1 AND user_id = $2`,
		[recordingId, userId],
	);
	return result.rows.length > 0 && result.rows[0].consent_type !== 'withdrawn';
}

/**
 * Set recording retention to 30 days after the hiring decision (#322).
 * Called when an application reaches a terminal decision (hired/rejected);
 * the per-recording retention_expires_at is set explicitly rather than
 * relying on the 90-day table default.
 * @param {number} applicationId
 * @param {number} [daysAfterDecision=30]
 * @returns {Promise<number>} number of recordings updated
 */
async function setSessionRecordingsRetentionAfterDecision(applicationId, daysAfterDecision = 30) {
	const retentionDate = new Date(Date.now() + daysAfterDecision * 24 * 60 * 60 * 1000);
	const result = await pool.query(
		`UPDATE interview_recordings
		 SET retention_expires_at = $1, updated_at = NOW()
		 WHERE interview_session_id IN (SELECT id FROM interview_sessions WHERE application_id = $2)`,
		[retentionDate, applicationId],
	);
	return result.rowCount;
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
	// Issue #323 — Session-linked rooms
	findActiveRoomBySessionId,
	createSessionRoomRecord,
	findOrCreateSessionRoom,
	dispatchVoiceAgent,
	dispatchAgentToRoom,
	getVoiceAgentName,
	findRoomById,
	validateRoomAccess,
	autoCreateRoomForInterview,
	// Issue #126 — Recording
	startRoomRecording,
	stopRoomRecording,
	getEgressInfo,
	// Issue #323 Task 6 — session egress
	getRecordingRetentionDate,
	startSessionEgress,
	stopSessionEgress,
	createRecordingRecord,
	completeRecordingRecord,
	failRecordingRecord,
	findRecordingById,
	findActiveRecordingByRoomId,
	findRecordingBySessionId,
	hasActiveConsent,
	setSessionRecordingsRetentionAfterDecision,
	listRecordingsByEventId,
	decryptStoragePath,
	downloadRecordingAudio,
};
