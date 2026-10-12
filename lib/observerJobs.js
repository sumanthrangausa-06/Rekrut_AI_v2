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
	try {
		const { rows } = await db.query(
			`INSERT INTO observer_jobs (interview_session_id, status)
			 VALUES ($1, 'pending')
			 RETURNING id, interview_session_id, status, created_at`,
			[sessionId],
		);
		return rows[0];
	} catch (err) {
		if (err.code === '23505') {
			// Unique violation — job already exists, return it (idempotent)
			const { rows } = await db.query(
				`SELECT id, interview_session_id, status, worker_id, created_at
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
		 RETURNING id, interview_session_id, status, worker_id`,
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
 * Mark a job as flushing (session ended, running final analysis).
 * @param {number} jobId
 */
async function markFlushing(jobId) {
	await db.query(
		`UPDATE observer_jobs SET status = 'flushing', updated_at = NOW()
		 WHERE id = $1`,
		[jobId],
	);
}

/**
 * Mark a job complete (report written).
 * @param {number} jobId
 */
async function complete(jobId) {
	await db.query(
		`UPDATE observer_jobs SET status = 'complete', updated_at = NOW()
		 WHERE id = $1`,
		[jobId],
	);
}

/**
 * Cancel a job (consent withdrawn/revoked). Terminal state — never resurrected.
 * @param {number} jobId
 * @param {string} reason - why cancelled (for error_message)
 */
async function cancel(jobId, reason) {
	await db.query(
		`UPDATE observer_jobs
		 SET status = 'cancelled', error_message = $2, updated_at = NOW()
		 WHERE id = $1`,
		[jobId, reason],
	);
}

/**
 * Mark a job failed (unrecoverable error). Terminal state.
 * @param {number} jobId
 * @param {string} errorMessage
 */
async function fail(jobId, errorMessage) {
	await db.query(
		`UPDATE observer_jobs
		 SET status = 'failed', error_message = $2, updated_at = NOW()
		 WHERE id = $1`,
		[jobId, errorMessage],
	);
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
