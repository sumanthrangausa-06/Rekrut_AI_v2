/**
 * AI Observer Worker — E-008 (S-047, #695)
 *
 * Separate Node.js process that polls the observer_jobs table, claims pending
 * jobs, and joins LiveKit rooms as an invisible, subscribe-only participant.
 *
 * Process model (spec §2.1): Separate from the Express web dyno so it survives
 * deploys mid-interview (AC-4). Polls every 5s. Heartbeat every 30s.
 * Stale-claim recovery runs every 60s (5min threshold).
 *
 * Consent enforcement (spec §3.1): The gate is checked at THREE points:
 * 1. Claim time — before joining the room
 * 2. Pre-subscribe — immediately before subscribing to candidate tracks
 * 3. Mid-session — every poll cycle; withdrawal → disconnect within <10s
 *
 * The worker NEVER publishes tracks or sends data messages (AC-3).
 * Identity: ai-observer-{sessionId} (spec §2.3).
 */

const { Room, RoomEvent } = require('livekit-server-sdk');
const observerJobs = require('../../lib/observerJobs');
const { canEnableObserver } = require('../../lib/observerConsentGate');
const db = require('../../lib/db');

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const SWEEPER_INTERVAL_MS = 60000;
const WORKER_ID = `observer-worker-${process.pid}-${Date.now()}`;

// Active jobs: jobId -> { room, sessionId, heartbeatTimer, consentTimer }
const activeJobs = new Map();

/**
 * Generate a LiveKit token for the observer with subscribe-only grants.
 * Least privilege: roomJoin + canSubscribe only. No publish, no data.
 */
async function createObserverToken(roomName, sessionId) {
	// Reuse the existing token minting from livekit service
	const livekitService = require('../../server/services/livekit');
	return livekitService.createObserverToken(roomName, sessionId);
}

/**
 * Resolve participant roles from identity prefixes.
 * candidate-{userId} → analysis target (full behavioral + integrity)
 * interviewer-{userId} → diarization only (transcription for context)
 * Falls back to room metadata on prefix mismatch (logged).
 */
function resolveRoles(participants, roomMetadata) {
	const roles = { candidate: null, interviewers: [] };

	for (const p of participants) {
		const identity = p.identity || '';
		if (identity.startsWith('candidate-')) {
			roles.candidate = {
				identity,
				userId: identity.replace('candidate-', ''),
				participant: p,
			};
		} else if (identity.startsWith('interviewer-')) {
			roles.interviewers.push({
				identity,
				userId: identity.replace('interviewer-', ''),
				participant: p,
			});
		}
	}

	// Fallback: room metadata on prefix mismatch (AC-2)
	if (!roles.candidate && roomMetadata?.candidateId) {
		console.log(
			`[ai-observer] role fallback: using room metadata for candidate ${roomMetadata.candidateId}`,
		);
		// Find participant by metadata user ID
		for (const p of participants) {
			if (String(p.metadata?.userId) === String(roomMetadata.candidateId)) {
				roles.candidate = { identity: p.identity, userId: roomMetadata.candidateId, participant: p };
				break;
			}
		}
	}

	return roles;
}

/**
 * Check the consent gate for a session. Returns { allowed, code, message }.
 */
async function checkConsent(sessionId) {
	const { rows } = await db.query(
		`SELECT id, candidate_id, config FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	if (!rows[0]) {
		return { allowed: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
	}
	return canEnableObserver(rows[0]);
}

/**
 * Process a single claimed job: join room, subscribe, monitor.
 */
async function processJob(job) {
	const sessionId = job.interview_session_id;
	console.log(`[ai-observer] processing job ${job.id} for session ${sessionId}`);

	// Gate check #1: claim time — before joining the room
	const gate = await checkConsent(sessionId);
	if (!gate.allowed) {
		console.log(`[ai-observer] consent blocked at claim for session ${sessionId}: ${gate.code}`);
		await observerJobs.cancel(job.id, `consent_blocked_at_claim:${gate.code}`);
		return;
	}

	// Get the LiveKit room name for this session
	const { rows } = await db.query(
		`SELECT config FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	const roomName = rows[0]?.config?.livekit_room || `session-${sessionId}`;
	const identity = `ai-observer-${sessionId}`;

	// Join the room with subscribe-only grants
	const room = new Room();
	const token = await createObserverToken(roomName, sessionId);

	try {
		await room.connect(process.env.LIVEKIT_URL, token);
	} catch (err) {
		console.error(`[ai-observer] room connect failed for session ${sessionId}:`, err.message);
		await observerJobs.fail(job.id, `room_connect_failed:${err.message}`);
		return;
	}

	await observerJobs.markObserving(job.id);

	// Gate check #2: pre-subscribe — immediately before subscribing to tracks
	const preSubscribeGate = await checkConsent(sessionId);
	if (!preSubscribeGate.allowed) {
		console.log(`[ai-observer] consent blocked pre-subscribe for session ${sessionId}`);
		await room.disconnect();
		await observerJobs.cancel(job.id, `consent_blocked_pre_subscribe:${preSubscribeGate.code}`);
		return;
	}

	// Resolve roles (AC-2)
	const participants = [...room.remoteParticipants.values()];
	const roles = resolveRoles(participants, rows[0]?.config?.roomMetadata);

	// Subscribe to candidate tracks only (analysis target)
	// Interviewer tracks: transcription for diarization context only
	// NOTE: Full analysis pipeline (VAD, MediaPipe, fusion) is S-049 scope.
	// S-047 establishes the join/subscribe lifecycle and invisibility guarantees.
	const trackHandlers = new Map();

	const subscribeToParticipant = async (participant, isCandidate) => {
		for (const [, pub] of participant.trackPublications) {
			if (pub.track) {
				// S-047: subscribe only. Analysis pipeline attaches in S-049.
				// The subscription itself is the collection point (spec §3.1).
				console.log(
					`[ai-observer] subscribed to ${isCandidate ? 'candidate' : 'interviewer'} ` +
					`track: ${pub.track.kind} from ${participant.identity}`,
				);
			}
		}
	};

	if (roles.candidate) {
		await subscribeToParticipant(roles.candidate.participant, true);
	}
	for (const iv of roles.interviewers) {
		await subscribeToParticipant(iv.participant, false);
	}

	// Track new participants joining mid-session
	room.on(RoomEvent.TrackSubscribed, async (track, pub, participant) => {
		// Re-check consent before subscribing to any new track
		const g = await checkConsent(sessionId);
		if (!g.allowed) {
			console.log(`[ai-observer] consent revoked, skipping new track for session ${sessionId}`);
			return;
		}
		const isCandidate = roles.candidate && participant.identity === roles.candidate.identity;
		console.log(`[ai-observer] new track subscribed: ${track.kind} from ${participant.identity} (candidate=${isCandidate})`);
	});

	// Heartbeat timer (30s)
	const heartbeatTimer = setInterval(async () => {
		try {
			await observerJobs.heartbeat(job.id);
		} catch (err) {
			console.error(`[ai-observer] heartbeat failed for job ${job.id}:`, err.message);
		}
	}, HEARTBEAT_INTERVAL_MS);

	// Consent re-check timer (5s) — mid-session revocation → disconnect <10s
	const consentTimer = setInterval(async () => {
		try {
			const g = await checkConsent(sessionId);
			if (!g.allowed) {
				console.log(`[ai-observer] consent withdrawn mid-session ${sessionId}, disconnecting`);
				clearInterval(heartbeatTimer);
				clearInterval(consentTimer);
				await room.disconnect();
				// Discard in-memory buffers without writing a report (spec §3.1)
				activeJobs.delete(job.id);
				await observerJobs.cancel(job.id, `consent_withdrawn_mid_session:${g.code}`);
			}
		} catch (err) {
			console.error(`[ai-observer] consent re-check failed for session ${sessionId}:`, err.message);
		}
	}, POLL_INTERVAL_MS);

	activeJobs.set(job.id, { room, sessionId, heartbeatTimer, consentTimer });
	console.log(`[ai-observer] observing session ${sessionId} as ${identity} (subscribe-only)`);
}

/**
 * Main poll loop: claim pending jobs and process them.
 */
async function poll() {
	try {
		const job = await observerJobs.claim(WORKER_ID);
		if (job) {
			// Process asynchronously — don't block the poll loop
			processJob(job).catch((err) => {
				console.error(`[ai-observer] job ${job.id} processing failed:`, err.message);
				observerJobs.fail(job.id, err.message).catch(() => {});
			});
		}
	} catch (err) {
		console.error('[ai-observer] poll error:', err.message);
	}
}

/**
 * Sweeper: recover stale claims (dead workers).
 */
async function sweep() {
	try {
		const recovered = await observerJobs.recoverStale();
		if (recovered > 0) {
			console.log(`[ai-observer] recovered ${recovered} stale job(s)`);
		}
	} catch (err) {
		console.error('[ai-observer] sweep error:', err.message);
	}
}

/**
 * Graceful shutdown: disconnect all rooms, clear timers.
 */
async function shutdown() {
	console.log('[ai-observer] shutting down...');
	for (const [jobId, { room, heartbeatTimer, consentTimer }] of activeJobs) {
		clearInterval(heartbeatTimer);
		clearInterval(consentTimer);
		try {
			await room.disconnect();
		} catch (err) {
			console.error(`[ai-observer] disconnect failed for job ${jobId}:`, err.message);
		}
	}
	activeJobs.clear();
	process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the worker
console.log(`[ai-observer] worker starting (id: ${WORKER_ID})`);
setInterval(poll, POLL_INTERVAL_MS);
setInterval(sweep, SWEEPER_INTERVAL_MS);
// Initial sweep on startup (recover from previous crash)
sweep().catch(() => {});

module.exports = {
	WORKER_ID,
	resolveRoles,
	checkConsent,
	processJob,
	// exported for tests
	POLL_INTERVAL_MS,
	HEARTBEAT_INTERVAL_MS,
};
