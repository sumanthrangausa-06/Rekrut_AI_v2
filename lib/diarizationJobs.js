/**
 * diarizationJobs — Job queue for the speaker-labelling (diarization)
 * worker (S-D03, #1905; Architecture §3.3, ADR-D02).
 *
 * A direct sibling of lib/observerJobs.js — same claim shape
 * (SELECT … FOR UPDATE SKIP LOCKED), heartbeat, stale-claim sweeper and
 * guarded terminal transitions. The queue is the SOURCE OF TRUTH for
 * labelling work; `interview_recordings.diarization_status` is only a
 * denormalized read cache maintained by the worker (S-D04+).
 *
 * Lifecycle: pending → claimed → processing → complete
 * Terminal states (never resurrected): cancelled, failed (subject to
 * the retry rule below), complete.
 *
 * Diarization-specific deviations from the observer precedent (§3.3):
 * - One row per (recording, transcription generation). Enqueue
 *   supersedes: any still-`pending` job for the recording is cancelled
 *   with reason `superseded_by_retranscription`. A claimed/processing
 *   job is NEVER cancelled under the worker's feet — the generation
 *   guard at write time (§3.6) discards its stale output instead.
 * - Retries: a `failed` job may be re-claimed while attempt_count < 3.
 *   Deterministic failures (decode error, segments missing) exhaust
 *   the attempt budget at fail() time and are never re-claimed.
 * - Cancel reasons are structured strings, mirroring the observer
 *   precedent: `consent_blocked_at_claim:<CODE>`,
 *   `consent_blocked_at_write:<CODE>`, `superseded_by_retranscription`,
 *   `segments_unavailable`. They live in `cancel_reason`, not
 *   `error_message` (the §4.2 schema separates the two).
 *
 * NOTE: Callers MUST pass the consent gate before processing — the
 * claim-time gate itself is the worker's job (S-D04, BR-2/BR-3). This
 * module is the queue, not the gate.
 */

const db = require('./db');

const MAX_ATTEMPTS = 3;
// Failure classes that can never succeed on a retry (§3.3).
const DETERMINISTIC_ERROR_CLASSES = new Set(['decode_failed', 'segments_unavailable']);

/**
 * Enqueue a diarization job for a recording. Supersedes any still-
 * pending job for the same recording (re-transcription generation).
 *
 * @param {number} recordingId - interview_recordings.id
 * @returns {Promise<object>} the new job row
 */
async function enqueue(recordingId) {
	await db.query(
		`UPDATE diarization_jobs
		 SET status = 'cancelled', cancel_reason = 'superseded_by_retranscription',
		     updated_at = NOW()
		 WHERE recording_id = $1 AND status = 'pending'`,
		[recordingId],
	);
	const { rows } = await db.query(
		`INSERT INTO diarization_jobs (recording_id, status)
		 VALUES ($1, 'pending')
		 RETURNING id, recording_id, status, attempt_count, created_at`,
		[recordingId],
	);
	return rows[0];
}

/**
 * Claim the next claimable job: the oldest `pending` job, or a
 * retryable `failed` job (attempt_count < MAX_ATTEMPTS). Uses SELECT
 * FOR UPDATE SKIP LOCKED so multiple workers can poll safely without
 * double-claiming. Claiming increments attempt_count (§3.3).
 *
 * @param {string} workerId - unique worker identifier
 * @returns {Promise<object|null>} the claimed job, or null if none claimable
 */
async function claim(workerId) {
	const { rows } = await db.query(
		`UPDATE diarization_jobs
		 SET status = 'claimed', worker_id = $1, claimed_at = NOW(),
		     last_heartbeat = NOW(), attempt_count = attempt_count + 1,
		     error_class = NULL, error_message = NULL,
		     updated_at = NOW()
		 WHERE id = (
		   SELECT id FROM diarization_jobs
		   WHERE status = 'pending'
		      OR (status = 'failed' AND attempt_count < $2)
		   ORDER BY created_at ASC
		   LIMIT 1
		   FOR UPDATE SKIP LOCKED
		 )
		 RETURNING id, recording_id, status, worker_id, attempt_count`,
		[workerId, MAX_ATTEMPTS],
	);
	return rows[0] || null;
}

/**
 * Update the job heartbeat. Called every 30s by the worker while active.
 * @param {number} jobId
 */
async function heartbeat(jobId) {
	await db.query(
		`UPDATE diarization_jobs SET last_heartbeat = NOW(), updated_at = NOW()
		 WHERE id = $1`,
		[jobId],
	);
}

/**
 * Mark a job as processing (worker passed the claim-time gates and the
 * engine run has started). Guarded — only a claimed job can start
 * processing, so a racing transition cannot resurrect a terminal job.
 * @param {number} jobId
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function markProcessing(jobId) {
	const { rowCount } = await db.query(
		`UPDATE diarization_jobs SET status = 'processing', updated_at = NOW()
		 WHERE id = $1 AND status = 'claimed'`,
		[jobId],
	);
	return rowCount;
}

/**
 * Mark a job complete (labelled output persisted). Guarded — only a
 * processing job can complete, so a late completion cannot overwrite
 * a job cancelled in the meantime.
 * @param {number} jobId
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function complete(jobId) {
	const { rowCount } = await db.query(
		`UPDATE diarization_jobs SET status = 'complete', updated_at = NOW()
		 WHERE id = $1 AND status = 'processing'`,
		[jobId],
	);
	return rowCount;
}

/**
 * Cancel a job with a structured reason (consent blocked, superseded,
 * segments unavailable). Terminal state — never resurrected. Guarded —
 * only non-terminal jobs can be cancelled; note a claimed/processing
 * job may be cancelled by the consent path (BR-2/BR-3), while the
 * supersede path in enqueue() only ever touches `pending` jobs.
 * @param {number} jobId
 * @param {string} reason - structured cancel reason (stored in cancel_reason)
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function cancel(jobId, reason) {
	const { rowCount } = await db.query(
		`UPDATE diarization_jobs
		 SET status = 'cancelled', cancel_reason = $2, updated_at = NOW()
		 WHERE id = $1 AND status IN ('pending', 'claimed', 'processing')`,
		[jobId, reason],
	);
	return rowCount;
}

/**
 * Mark a job failed with its error class recorded (§3.3 taxonomy:
 * decode_failed / engine_failed / engine_timeout / engine_oom).
 * Deterministic classes exhaust the attempt budget so claim() never
 * retries them. Terminal unless retryable via claim(). Guarded —
 * only non-terminal jobs can fail.
 * @param {number} jobId
 * @param {string} errorClass
 * @param {string} errorMessage - server-side only; never rendered to users
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function fail(jobId, errorClass, errorMessage) {
	const attemptFloor = DETERMINISTIC_ERROR_CLASSES.has(errorClass) ? MAX_ATTEMPTS : 0;
	const { rowCount } = await db.query(
		`UPDATE diarization_jobs
		 SET status = 'failed', error_class = $2, error_message = $3,
		     attempt_count = GREATEST(attempt_count, $4), updated_at = NOW()
		 WHERE id = $1 AND status IN ('pending', 'claimed', 'processing')`,
		[jobId, errorClass, errorMessage, attemptFloor],
	);
	return rowCount;
}

/**
 * Recover stale claims. Resets claimed/processing jobs with dead
 * heartbeats (>5 min) back to pending. EXPLICITLY excludes terminal
 * states (cancelled, failed, complete) — a consent-cancelled job must
 * never be resurrected. (A retryable failed job needs no recovery: it
 * is claimable as-is.)
 *
 * @returns {Promise<number>} count of recovered jobs
 */
async function recoverStale() {
	const { rowCount } = await db.query(
		`UPDATE diarization_jobs
		 SET status = 'pending', worker_id = NULL, claimed_at = NULL,
		     last_heartbeat = NULL, updated_at = NOW()
		 WHERE status IN ('claimed', 'processing')
		   AND last_heartbeat < NOW() - INTERVAL '5 minutes'
		   AND status NOT IN ('cancelled', 'failed', 'complete')`,
	);
	return rowCount;
}

/**
 * Get the latest job for a recording (the current generation's state).
 * @param {number} recordingId
 * @returns {Promise<object|null>} job row or null
 */
async function getStatus(recordingId) {
	const { rows } = await db.query(
		`SELECT id, recording_id, status, worker_id, cancel_reason,
		        claimed_at, last_heartbeat, attempt_count,
		        error_class, error_message, created_at, updated_at
		 FROM diarization_jobs WHERE recording_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		[recordingId],
	);
	return rows[0] || null;
}

module.exports = {
	enqueue,
	claim,
	heartbeat,
	markProcessing,
	complete,
	cancel,
	fail,
	recoverStale,
	getStatus,
	MAX_ATTEMPTS,
};
