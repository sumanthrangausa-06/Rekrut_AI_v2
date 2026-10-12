/**
 * AI Observer Worker — E-008 (S-047, #695)
 *
 * Polls the observer_jobs table, claims pending jobs, and joins LiveKit rooms
 * as an invisible, subscribe-only participant.
 *
 * Process model (spec §2.1, revised 2026-10-12 per Rex + Sumanth's $0 decision):
 * runs IN-PROCESS — server.js starts the poll loop at web boot. The job queue
 * (observer_jobs, SKIP LOCKED, heartbeats, stale-claim sweeper) is
 * process-agnostic by design, so this is a few lines at startup. Switch to a
 * separate Render worker later by running this module directly
 * (require.main === module already supports standalone mode).
 *
 * Polls every 5s. Heartbeat every 30s. Stale-claim recovery every 60s
 * (5min threshold).
 *
 * Consent enforcement (spec §3.1): The gate is checked at THREE points:
 * 1. Claim time — before joining the room
 * 2. Pre-subscribe — immediately before subscribing to candidate tracks
 * 3. Mid-session — every poll cycle; withdrawal → disconnect within <10s
 *
 * Session end (S-049a, spec §4.4): the same 5s tick watches the session
 * `status`; on 'completed' it disconnects and flushes the observer report
 * via lib/observerReportWriter.js (granted sessions only — no row is ever
 * written for declined/unknown consent).
 *
 * The worker NEVER publishes tracks or sends data messages (AC-3).
 * Identity: ai-observer-{sessionId} (spec §2.3).
 */

const { Room, RoomEvent } = require('@livekit/rtc-node');
const observerJobs = require('../../lib/observerJobs');
const { canEnableObserver } = require('../../lib/observerConsentGate');
const { flushReport } = require('../../lib/observerReportWriter');
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
 * Check the consent gate for a session. Returns the gate result plus the
 * session's lifecycle status (S-049a: the consent tick doubles as the
 * session-completion watcher — see the consent timer in processJob).
 * @returns {Promise<{ allowed: boolean, code?: string, message?: string, sessionStatus: string|null }>}
 */
async function checkConsent(sessionId) {
	const { rows } = await db.query(
		`SELECT id, status, config FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	if (!rows[0]) {
		return { allowed: false, code: 'SESSION_NOT_FOUND', message: 'Session not found', sessionStatus: null };
	}
	return { ...canEnableObserver(rows[0]), sessionStatus: rows[0].status };
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

	// Join the room with subscribe-only grants.
	// BLOCKER 3 fix (privacy-engineer): autoSubscribe MUST be false.
	// The LiveKit SDK auto-subscribes during connect() by default — that would
	// put collection BEFORE the gate. We subscribe explicitly per-track only
	// after a passing gate check.
	const room = new Room({ autoSubscribe: false });
	const token = await createObserverToken(roomName, sessionId);

	try {
		await room.connect(process.env.LIVEKIT_URL, token);
	} catch (err) {
		console.error(`[ai-observer] room connect failed for session ${sessionId}:`, err.message);
		await observerJobs.fail(job.id, `room_connect_failed:${err.message}`);
		return;
	}

	await observerJobs.markObserving(job.id);

	// Gate check #2: pre-subscribe — runs BEFORE any subscription.
	// With autoSubscribe: false, no tracks are subscribed yet. We explicitly
	// subscribe per-track below only after this gate passes.
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

	// Explicit subscription (autoSubscribe: false) — gate already passed.
	// S-047: subscribe only. Analysis pipeline attaches in S-049.
	const subscribeToParticipant = async (participant, isCandidate) => {
		for (const [, pub] of participant.trackPublications) {
			if (pub.track) {
				// Explicit subscribe — only reached after passing gate check #2
				await pub.setSubscribed(true);
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

	// BLOCKER 2+3 fix (privacy-engineer): gate on TrackPublished (not TrackSubscribed).
	// TrackSubscribed fires AFTER the SDK subscribes — too late for the gate.
	// TrackPublished fires when a track is announced but before subscription.
	room.on(RoomEvent.TrackPublished, async (pub, participant) => {
		// Gate check before subscribing to any new track
		const g = await checkConsent(sessionId);
		if (!g.allowed) {
			console.log(`[ai-observer] consent blocked for new track from ${participant.identity}, NOT subscribing`);
			return; // Do not subscribe — gate failed
		}
		const isCandidate = roles.candidate && participant.identity === roles.candidate.identity;
		await pub.setSubscribed(true);
		console.log(`[ai-observer] new track subscribed: ${pub.kind} from ${participant.identity} (candidate=${isCandidate})`);
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
	// SHOULD-FIX 5 (privacy-engineer): fail-closed on DB errors. If the consent
	// check fails N times consecutively (DB unreachable), disconnect rather than
	// observe without verified consent.
	let consecutiveCheckFailures = 0;
	const MAX_CHECK_FAILURES = 3;
	const consentTimer = setInterval(async () => {
		try {
			const g = await checkConsent(sessionId);
			consecutiveCheckFailures = 0; // Reset on success

			// S-049a (spec §4.4, AC-1): session-end path. There is no
			// room-disconnect trigger — a transport drop is not a session
			// end. This tick already polls the session every 5s, so it
			// watches `status`: when the completion route flips it to
			// 'completed', leave the room and flush the observer report.
			// Consent is re-checked by this same tick (and again inside
			// flushReport): a revocation landing before the flush means
			// NO report row (AC-3/AC-6) — the job is cancelled instead.
			if (g.sessionStatus === 'completed') {
				clearInterval(heartbeatTimer);
				clearInterval(consentTimer);
				activeJobs.delete(job.id);
				try {
					await room.disconnect();
				} catch (e) { /* best-effort — session already over */ }
				if (g.allowed) {
					const result = await flushReport({ jobId: job.id, sessionId });
					console.log(
						`[ai-observer] session ${sessionId} completed — report flush: ${JSON.stringify(result)}`,
					);
				} else {
					console.log(
						`[ai-observer] session ${sessionId} completed without granted consent (${g.code}) — no report written`,
					);
					await observerJobs.cancel(job.id, `session_completed_consent_not_granted:${g.code}`);
				}
				return;
			}

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
			consecutiveCheckFailures++;
			console.error(
				`[ai-observer] consent re-check failed for session ${sessionId} ` +
				`(${consecutiveCheckFailures}/${MAX_CHECK_FAILURES}):`,
				err.message,
			);
			if (consecutiveCheckFailures >= MAX_CHECK_FAILURES) {
				console.log(
					`[ai-observer] consent unverifiable after ${MAX_CHECK_FAILURES} failures, ` +
					`disconnecting session ${sessionId} (fail-closed)`,
				);
				clearInterval(heartbeatTimer);
				clearInterval(consentTimer);
				try {
					await room.disconnect();
				} catch (e) { /* best-effort */ }
				activeJobs.delete(job.id);
				await observerJobs.cancel(job.id, 'consent_unverifiable_db_failure').catch(() => {});
			}
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

/**
 * Start the worker poll loop + stale-claim sweeper. Safe to call once at
 * process boot (server.js in-process mode) or from the standalone entry
 * point below. Returns the timer handles for stopWorker().
 */
function startWorker() {
	console.log(`[ai-observer] worker starting (id: ${WORKER_ID})`);
	const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
	const sweepTimer = setInterval(sweep, SWEEPER_INTERVAL_MS);
	// Initial sweep on startup (recover from previous crash)
	sweep().catch(() => {});
	return { pollTimer, sweepTimer };
}

/**
 * Stop the poll loop + sweeper (tests, graceful shutdown).
 */
function stopWorker(timers) {
	if (!timers) return;
	clearInterval(timers.pollTimer);
	clearInterval(timers.sweepTimer);
}

// Only register signal handlers and start the worker when this is the main
// module (standalone separate-process mode). In-process mode (server.js)
// manages its own lifecycle; stale claims recover via the 5min heartbeat
// timeout sweeper.
if (require.main === module) {
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
	startWorker();
}

module.exports = {
	WORKER_ID,
	resolveRoles,
	checkConsent,
	processJob,
	startWorker,
	stopWorker,
	// exported for tests
	POLL_INTERVAL_MS,
	HEARTBEAT_INTERVAL_MS,
};
