/**
 * observerJobs — Job queue for the E-008 AI Observer worker (S-047, #695).
 *
 * The job queue is the SOURCE OF TRUTH for observer dispatch.
 * `interview_sessions.config.observer_enabled` is intent only (recruiter toggle);
 * `observer_jobs.status` is reality (what the worker actually did).
 *
 * Lifecycle: pending → claimed → observing → flushing → complete
 * Terminal states (never resurrected): cancelled, failed, complete
 *
 * The worker claims jobs via SELECT FOR UPDATE SKIP LOCKED (safe for
 * multiple workers). Stale claims (dead worker) are recovered by the sweeper.
 */

const db = require('./db');
const { resolveEnvIdentity } = require('./observerEnvIdentity');

/**
 * Enqueue an observer job for a session. Idempotent — returns the existing
 * job if one already exists for the session (UNIQUE constraint).
 *
 * NOTE: Callers MUST pass the consent gate (canEnableObserver) BEFORE
 * calling enqueue. This function does not check consent — it's the queue,
 * not the gate.
 *
 * @param {number} sessionId - interview_sessions.id
 * @returns {Promise<object>} the job row
 */
async function enqueue(sessionId) {
	// Gate A (S-085 #787, design D-1): stamp the creating process's env
	// identity on the job. The capture gate (G-ENV) only lets a worker
	// capture a job whose origin_env equals its own identity — this is
	// what keeps a staging-created job from ever being captured by the
	// production worker (and vice versa). 'unknown' = capture-ineligible.
	const originEnv = resolveEnvIdentity();
	try {
		const { rows } = await db.query(
			`INSERT INTO observer_jobs (interview_session_id, status, origin_env)
			 VALUES ($1, 'pending', $2)
			 RETURNING id, interview_session_id, status, origin_env, created_at`,
			[sessionId, originEnv],
		);
		return rows[0];
	} catch (err) {
		if (err.code === '23505') {
			// Unique violation — job already exists, return it (idempotent)
			const { rows } = await db.query(
				`SELECT id, interview_session_id, status, worker_id, origin_env, created_at
				 FROM observer_jobs WHERE interview_session_id = $1`,
				[sessionId],
			);
			return rows[0];
		}
		throw err;
	}
}

/**
 * Claim the next pending job. Uses SELECT FOR UPDATE SKIP LOCKED so multiple
 * workers can poll safely without double-claiming.
 *
 * @param {string} workerId - unique worker identifier
 * @returns {Promise<object|null>} the claimed job, or null if none pending
 */
async function claim(workerId) {
	const { rows } = await db.query(
		`UPDATE observer_jobs
		 SET status = 'claimed', worker_id = $1, claimed_at = NOW(),
		     last_heartbeat = NOW(), attempt_count = attempt_count + 1,
		     updated_at = NOW()
		 WHERE id = (
		   SELECT id FROM observer_jobs
		   WHERE status = 'pending'
		   ORDER BY created_at ASC
		   LIMIT 1
		   FOR UPDATE SKIP LOCKED
		 )
		 RETURNING id, interview_session_id, status, worker_id, origin_env`,
		[workerId],
	);
	return rows[0] || null;
}

/**
 * Update the job heartbeat. Called every 30s by the worker while active.
 * @param {number} jobId
 */
async function heartbeat(jobId) {
	await db.query(
		`UPDATE observer_jobs SET last_heartbeat = NOW(), updated_at = NOW()
		 WHERE id = $1`,
		[jobId],
	);
}

/**
 * Mark a job as observing (worker joined the room, capture started).
 * @param {number} jobId
 */
async function markObserving(jobId) {
	await db.query(
		`UPDATE observer_jobs SET status = 'observing', updated_at = NOW()
		 WHERE id = $1`,
		[jobId],
	);
}

/**
 * Mark a job as flushing (session ended, writing the final report).
 * S-049a AC-4: guarded — only pre-flush lifecycle states may transition.
 * A terminal job (cancelled/failed/complete) can never re-enter flushing,
 * so a late flush cannot resurrect a consent-cancelled job.
 * @param {number} jobId
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function markFlushing(jobId) {
	const { rowCount } = await db.query(
		`UPDATE observer_jobs SET status = 'flushing', updated_at = NOW()
		 WHERE id = $1 AND status IN ('observing', 'claimed')`,
		[jobId],
	);
	return rowCount;
}

/**
 * Mark a job complete (report written).
 * S-049a AC-4: guarded — only a flushing job can complete, so a late
 * flush cannot "complete" a job cancelled mid-flush.
 * @param {number} jobId
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function complete(jobId) {
	const { rowCount } = await db.query(
		`UPDATE observer_jobs SET status = 'complete', updated_at = NOW()
		 WHERE id = $1 AND status = 'flushing'`,
		[jobId],
	);
	return rowCount;
}

/**
 * Cancel a job (consent withdrawn/revoked). Terminal state — never resurrected.
 * #779 (F4): guarded — only non-terminal jobs can be cancelled, so a late
 * cancel racing a completed flush cannot overwrite the terminal state.
 * @param {number} jobId
 * @param {string} reason - why cancelled (for error_message)
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function cancel(jobId, reason) {
	const { rowCount } = await db.query(
		`UPDATE observer_jobs
		 SET status = 'cancelled', error_message = $2, updated_at = NOW()
		 WHERE id = $1 AND status IN ('pending', 'claimed', 'observing', 'flushing')`,
		[jobId, reason],
	);
	return rowCount;
}

/**
 * Mark a job failed (unrecoverable error). Terminal state.
 * #779 (F4): guarded — only non-terminal jobs can fail, so a late error
 * racing a completed flush cannot overwrite the terminal state.
 * @param {number} jobId
 * @param {string} errorMessage
 * @returns {Promise<number>} rowCount — 1 if transitioned, 0 if guarded out
 */
async function fail(jobId, errorMessage) {
	const { rowCount } = await db.query(
		`UPDATE observer_jobs
		 SET status = 'failed', error_message = $2, updated_at = NOW()
		 WHERE id = $1 AND status IN ('pending', 'claimed', 'observing', 'flushing')`,
		[jobId, errorMessage],
	);
	return rowCount;
}

/**
 * Recover stale claims. Resets jobs with dead heartbeats (>5 min) back to
 * pending. EXPLICITLY excludes terminal states (cancelled, failed, complete)
 * — a consent-cancelled job must never be resurrected.
 *
 * @returns {Promise<number>} count of recovered jobs
 */
async function recoverStale() {
	const { rowCount } = await db.query(
		`UPDATE observer_jobs
		 SET status = 'pending', worker_id = NULL, claimed_at = NULL,
		     last_heartbeat = NULL, updated_at = NOW()
		 WHERE status IN ('claimed', 'observing', 'flushing')
		   AND last_heartbeat < NOW() - INTERVAL '5 minutes'
		   AND status NOT IN ('cancelled', 'failed', 'complete')`,
	);
	return rowCount;
}

/**
 * Get the job status for a session.
 * @param {number} sessionId
 * @returns {Promise<object|null>} job row or null
 */
async function getStatus(sessionId) {
	const { rows } = await db.query(
		`SELECT id, interview_session_id, status, worker_id,
		        claimed_at, last_heartbeat, attempt_count, error_message,
		        created_at, updated_at
		 FROM observer_jobs WHERE interview_session_id = $1`,
		[sessionId],
	);
	return rows[0] || null;
}

module.exports = {
	enqueue,
	claim,
	heartbeat,
	markObserving,
	markFlushing,
	complete,
	cancel,
	fail,
	recoverStale,
	getStatus,
};
