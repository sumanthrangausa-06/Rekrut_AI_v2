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
 *
 * Gate A dormant capture (S-085, #787; design gate-a-dormant-capture):
 * presence is NOT capture. A capture decision is evaluated once at Gate 2
 * (lib/observerCaptureGate.js). While DORMANT — the default, flag off —
 * the worker subscribes to NO media tracks at all and registers NO
 * TrackSubscribed handler: it receives nothing (§2.3 behaviour change;
 * previously it subscribed to every track for presence, which was
 * collection without a gate). While CAPTURING (test scope in this build;
 * activation is unreachable — no consent artefact ships), only the
 * candidate's AUDIO track is subscribed, frames feed
 * lib/observerCapture.js, and a 1 s watchdog enforces the ≤2 s kill
 * bound. The SDK's audio-level / speaking-indicator surfaces are never
 * sampled, logged, or stored in any mode.
 */

const { Room, RoomEvent, AudioStream, TrackKind } = require('@livekit/rtc-node');
const observerJobs = require('../../lib/observerJobs');
const { canEnableObserver } = require('../../lib/observerConsentGate');
const { flushReport } = require('../../lib/observerReportWriter');
const db = require('../../lib/db');
const { readCaptureFlag, consumeFlagTransition } = require('../../lib/observerCaptureFlag');
const { resolveEnvIdentity } = require('../../lib/observerEnvIdentity');
const { evaluateCaptureDecision, recheckCaptureGate } = require('../../lib/observerCaptureGate');
const observerCapture = require('../../lib/observerCapture');
const observerSpeech = require('../../lib/observerSpeech');

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const SWEEPER_INTERVAL_MS = 60000;
const WATCHDOG_INTERVAL_MS = 1000;
const WORKER_ID = `observer-worker-${process.pid}-${Date.now()}`;

// Active jobs: jobId -> { room, sessionId, heartbeatTimer, consentTimer, stopCapture }
const activeJobs = new Map();

// One capturing session per process (design §3.6 step 2). A second
// would-be-capturing session stays dormant with a concurrency_cap
// outcome row; leaving CAPTURING is one-way per session.
let activeCapture = null; // { jobId, sessionId } | null

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

	// Get the LiveKit room name for this session (+ the session row the
	// Gate A capture decision needs: candidate, company, config)
	const { rows } = await db.query(
		`SELECT id, candidate_id, company_id, config FROM interview_sessions WHERE id = $1`,
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

	// ── Gate A capture decision (design §3.6) ────────────────────────────
	// Evaluated ONCE, here at Gate 2, after presence passes and before any
	// subscription. A flag flipped ON later does nothing to a session that
	// decided dormant. Fail-closed: any evaluation error ⇒ dormant.
	let captureDecision = { decision: 'dormant', scope: 'none', gateCode: null, envIdentity: resolveEnvIdentity() };
	try {
		captureDecision = await evaluateCaptureDecision({
			session: rows[0],
			job,
			presence: preSubscribeGate,
			queryable: db,
		});
	} catch (err) {
		console.error(`[ai-observer] capture decision failed for session ${sessionId} (fail-closed dormant):`, err.message);
	}
	const flagTransition = consumeFlagTransition();
	if (flagTransition) {
		observerCapture.emitLog('flag_transition', {
			flag_state: flagTransition.to,
			scope: captureDecision.scope,
			env: captureDecision.envIdentity,
		});
	}
	observerCapture.emitLog('capture_decision', {
		flag_state: readCaptureFlag(),
		scope: captureDecision.scope,
		env: captureDecision.envIdentity,
		session_id: sessionId,
		gate_code: captureDecision.gateCode || undefined,
	});

	// Capture runtime for THIS session (null while dormant). While dormant
	// the worker subscribes to nothing and registers no track handlers —
	// presence (join, heartbeat, attendance/audit) is unaffected.
	let captureSession = null;
	let watchdogTimer = null;
	let captureStopped = false;
	const stopCapture = async (reason, { fromWatchdog = false } = {}) => {
		if (!captureSession || captureStopped) return;
		captureStopped = true;
		if (watchdogTimer) clearInterval(watchdogTimer);
		if (fromWatchdog) {
			observerCapture.emitLog('watchdog_teardown', {
				scope: captureSession.scope,
				env: captureDecision.envIdentity,
				session_id: sessionId,
				stop_reason: reason,
			});
		}
		try {
			await captureSession.finalize(reason);
		} catch (err) {
			console.error(`[ai-observer] capture finalize failed for session ${sessionId}:`, err.message);
		}
		if (activeCapture && activeCapture.jobId === job.id) activeCapture = null;
	};

	if (captureDecision.decision === 'capturing' && activeCapture) {
		// Concurrency cap (§3.6 step 2): one capturing session per process.
		// This session stays DORMANT; the cap is recorded as its outcome.
		observerCapture.emitLog('capture_decision', {
			flag_state: true,
			scope: captureDecision.scope,
			env: captureDecision.envIdentity,
			session_id: sessionId,
			gate_code: 'CAPTURE_CONCURRENCY_CAP',
		});
		const capCounters = observerCapture.createCaptureCounters();
		await observerCapture
			.writeCaptureOutcome({
				sessionId,
				candidateId: rows[0]?.candidate_id,
				scope: captureDecision.scope,
				isTest: captureDecision.scope === 'test',
				cohortAllowlistVersion: captureDecision.cohortAllowlistVersion ?? null,
				counters: capCounters,
				audioSecondsCaptured: 0,
				stopReason: 'concurrency_cap',
				startedAt: new Date(),
				queryable: db,
			})
			.catch(() => {});
	} else if (captureDecision.decision === 'capturing') {
		const counters = observerCapture.createCaptureCounters();
		captureSession = new observerCapture.CaptureSession({
			sessionId,
			candidateId: rows[0]?.candidate_id,
			jobId: job.id,
			scope: captureDecision.scope,
			isTest: captureDecision.scope === 'test',
			cohortAllowlistVersion: captureDecision.cohortAllowlistVersion ?? null,
			jobOriginEnv: job.origin_env,
			counters,
			pool: db,
		});
		activeCapture = { jobId: job.id, sessionId };
		if (roles.candidate) captureSession.bindIdentity(roles.candidate.identity);
		observerCapture.emitLog('capture_started', {
			flag_state: true,
			scope: captureDecision.scope,
			env: captureDecision.envIdentity,
			session_id: sessionId,
		});

		const KIND_AUDIO = TrackKind?.KIND_AUDIO ?? 1;
		const isAudioPub = (pub) => pub?.kind === KIND_AUDIO || pub?.track?.kind === KIND_AUDIO;

		// Frame consumption: candidate audio only. Stereo is downmixed to
		// mono by sample averaging (§3.4). The loop exits the moment the
		// session leaves CAPTURING (kill bound).
		const consumeAudioTrack = (track) => {
			counters.streamsOpened++;
			const stream = new AudioStream(track);
			const reader = stream.getReader();
			(async () => {
				try {
					while (captureSession.state === 'capturing') {
						const { done, value: frame } = await reader.read();
						if (done) break;
						if (!frame) continue;
						let pcm;
						if (frame.channels === 2) {
							const data = frame.data;
							const mono = new Int16Array(frame.samplesPerChannel);
							for (let i = 0; i < frame.samplesPerChannel; i++) {
								mono[i] = Math.round((data[i * 2] + data[i * 2 + 1]) / 2);
							}
							pcm = Buffer.from(mono.buffer, mono.byteOffset, mono.byteLength);
						} else {
							pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
						}
						// Copy — the SDK reuses frame buffers.
						pcm = Buffer.from(pcm);
						const r = await captureSession.onFrame(pcm, frame.sampleRate);
						if (r?.stop) {
							await stopCapture(r.stop);
							break;
						}
					}
				} catch (err) {
					console.error(`[ai-observer] audio stream error for session ${sessionId}:`, err.message);
				} finally {
					try { reader.releaseLock(); } catch { /* already closed */ }
				}
			})();
		};

		room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
			if (!captureSession || captureStopped) return;
			if (!track || track.kind !== KIND_AUDIO) return; // video is never consumed
			if (participant.identity !== captureSession.boundIdentity) return;
			consumeAudioTrack(track);
		});

		const subscribeCandidateAudio = async (participant) => {
			for (const [, pub] of participant.trackPublications) {
				if (isAudioPub(pub)) {
					await pub.setSubscribed(true);
				}
			}
		};

		if (roles.candidate) {
			await subscribeCandidateAudio(roles.candidate.participant);
		}

		// Late publications: candidate audio only; a NEW candidate identity
		// mid-capture is a role flip (§3.5).
		room.on(RoomEvent.TrackPublished, async (pub, participant) => {
			if (!captureSession || captureStopped) return;
			if (!isAudioPub(pub)) return;
			if (!captureSession.verifyIdentity(participant.identity)) {
				await stopCapture('role_flip', { fromWatchdog: true });
				return;
			}
			if (captureSession.boundIdentity && participant.identity === captureSession.boundIdentity) {
				await pub.setSubscribed(true);
			} else if (!captureSession.boundIdentity && String(participant.identity).startsWith('candidate-')) {
				captureSession.bindIdentity(participant.identity);
				await pub.setSubscribed(true);
			}
			// Interviewer tracks are never subscribed for capture.
		});

		// 1 s watchdog (§3.4): flag + consent + env re-checked; teardown
		// completes within the same tick (≤2 s kill bound end-to-end).
		let watchdogFailures = 0;
		watchdogTimer = setInterval(async () => {
			if (!captureSession || captureStopped) return;
			const t = consumeFlagTransition();
			if (t) {
				observerCapture.emitLog('flag_transition', {
					flag_state: t.to,
					scope: captureSession.scope,
					env: captureDecision.envIdentity,
					session_id: sessionId,
				});
			}
			try {
				const rc = await recheckCaptureGate({
					sessionId,
					candidateId: rows[0]?.candidate_id,
					scope: captureSession.scope,
					jobOriginEnv: job.origin_env,
					queryable: db,
				});
				if (rc.ok) {
					watchdogFailures = 0;
					return;
				}
				if (rc.kind === 'flag_off') return stopCapture('flag_off', { fromWatchdog: true });
				if (rc.kind === 'withdrawn') return stopCapture('consent_withdrawn', { fromWatchdog: true });
				if (rc.kind === 'env') return stopCapture('consent_check_failed', { fromWatchdog: true });
				// check_failed: fail-closed after 3 consecutive failures,
				// mirroring the presence tick's policy.
				watchdogFailures++;
				if (watchdogFailures >= 3) return stopCapture('consent_check_failed', { fromWatchdog: true });
			} catch (err) {
				watchdogFailures++;
				if (watchdogFailures >= 3) return stopCapture('consent_check_failed', { fromWatchdog: true });
			}
		}, WATCHDOG_INTERVAL_MS);
	}

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
				// Gate A: capture teardown runs FIRST (session_end) so the
				// measurements + outcome are written while the job row and
				// room are still intact.
				await stopCapture('session_end');
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
				// Gate A §5.4: capture stops FIRST (≤2 s bound), buffers
				// discarded, persisted artefacts queued for deletion by
				// the withdrawal sweeper.
				await stopCapture('consent_withdrawn');
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
				await stopCapture('consent_check_failed');
				try {
					await room.disconnect();
				} catch (e) { /* best-effort */ }
				activeJobs.delete(job.id);
				await observerJobs.cancel(job.id, 'consent_unverifiable_db_failure').catch(() => {});
			}
		}
	}, POLL_INTERVAL_MS);

	activeJobs.set(job.id, { room, sessionId, heartbeatTimer, consentTimer, stopCapture });
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
 * Sweeper: recover stale claims (dead workers) + Gate A maintenance on
 * the same 60 s cadence (design §4.4/§5.4): retire stale capture intents,
 * queue withdrawn sessions' artefacts for deletion. Each step is
 * isolated — one failing sweep must not block the others.
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
	try {
		await observerCapture.reconcileObserverAudioIntents({});
	} catch (err) {
		console.error('[ai-observer] capture intent reconcile error:', err.message);
	}
	try {
		await observerCapture.sweepWithdrawnCaptureArtefacts({});
	} catch (err) {
		console.error('[ai-observer] withdrawn-artefact sweep error:', err.message);
	}
}

/**
 * Graceful shutdown: disconnect all rooms, clear timers.
 */
async function shutdown() {
	console.log('[ai-observer] shutting down...');
	for (const [jobId, { room, heartbeatTimer, consentTimer, stopCapture }] of activeJobs) {
		clearInterval(heartbeatTimer);
		clearInterval(consentTimer);
		// Gate A: an in-flight capture finalizes as worker_shutdown so its
		// outcome row records why it stopped (§8.5).
		if (stopCapture) {
			try { await stopCapture('worker_shutdown'); } catch { /* best-effort */ }
		}
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
	// Gate A §7.4: crash sweep of the capture workdir BEFORE any job is
	// claimed — zero + delete anything a crashed process left behind
	// (counts only in the log).
	try {
		const swept = observerSpeech.sweepCaptureWorkdir();
		if (swept > 0) {
			console.log(`[ai-observer] capture workdir crash sweep removed ${swept} leftover file(s)`);
		}
	} catch { /* hygiene must never block startup */ }
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
	WATCHDOG_INTERVAL_MS,
	_getActiveCapture: () => activeCapture,
};
