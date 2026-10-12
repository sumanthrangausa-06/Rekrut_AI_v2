/**
 * observerReportWriter — S-049a (#776): AI Observer report writer (scaffold).
 *
 * Persists ONE honest report row per completed, consented session into
 * `ai_observer_reports` (migration 256), per E-008 spec §4.3/§4.4.
 *
 * SCAFFOLD SCOPE: there is no analysis pipeline yet (E-004/E-005 unbuilt;
 * S-049b builds it against this frozen contract). Every section is a state
 * skeleton — biometric states resolved through lib/observerReportStates.js
 * — `missing` where no analysis exists. Nothing is fabricated: no scores,
 * no signals, no events. When E-004 lands, its writers fill these sections
 * inside this same flush path.
 *
 * Write rules (panel decision 2026-10-12, spec §4.3):
 * - Fires ONLY for granted sessions (default-deny gate,
 *   lib/observerConsentGate.js). Every written row carries
 *   consent_state = 'granted', set explicitly. Declined/withdrawn/unknown
 *   sessions get NO row — a row would itself be observation metadata
 *   about a candidate who never consented to observation. Their state is
 *   derived from consent at read time (lib/observerReportStates.js).
 * - Idempotent (AC-4): INSERT … ON CONFLICT (interview_session_id)
 *   DO NOTHING. First data-bearing write wins — never an upsert.
 * - Erasure safety (AC-5): inside the write transaction, the job row is
 *   locked and re-checked — abort if it is gone or not `flushing`.
 *   Erasure deletes BOTH tables (lib/erasureService.js), so a missing
 *   job row means erasure is in progress or complete; writing then
 *   would resurrect erased data. A consent re-check alone is NOT
 *   sufficient: erasure deliberately retains the consent fact, so the
 *   gate would still pass post-erasure.
 *
 * ⚠️ The erasure race is NARROWED here, NOT closed (Nova's dissent,
 * panel 2026-10-12): the fully-concurrent window — an erasure
 * transaction running mid-flush — needs a shared advisory lock inside
 * erasureService. That hardening belongs to S-049b.
 *
 * Isolation (AC-7): this writer never touches interview_sessions.config
 * — the Track B `config.report` is a different report owned by a
 * different path.
 */

const db = require('./db');
const observerJobs = require('./observerJobs');
const { canEnableObserver } = require('./observerConsentGate');
const { getReportSectionStates } = require('./observerReportStates');

/**
 * Build the §4.3 report skeleton for a session. Section states resolve
 * through observerReportStates.js (never hardcoded here): with no
 * pipeline data, biometric sections are `missing` for a granted session.
 * Biometric sections carry ONLY the state — no metric keys at all, so
 * nothing can be misread as a measurement.
 *
 * @param {object} session — interview_sessions row (needs .config)
 * @returns {{ analysis: object, integrity_summary: object }}
 */
function buildReportSkeleton(session) {
	const states = getReportSectionStates({ session, dataBySection: {} });
	const analysis = {
		vocal: { state: states.vocal.state },
		visual: { state: states.visual.state },
		// Non-biometric section: observerReportStates.js resolves the
		// BIOMETRIC sections only, so this one is set directly — honestly
		// missing, because the scaffold captures no transcript. (For the
		// granted sessions this writer serves, `missing` is the correct
		// state; a declined session never reaches this code, AC-3.)
		conversation: { state: 'missing', transcript_available: false },
	};
	const integrity_summary = {
		// Projection shape version (spec §4.3): bump on shape changes;
		// consumers must tolerate older versions. The summary is a
		// derived projection of a future integrity_events table, never
		// a second authoritative store.
		version: 1,
		state: states.integrity.state,
		events: [],
		total_events: 0,
		critical_count: 0,
		warning_count: 0,
		info_count: 0,
	};
	return { analysis, integrity_summary };
}

/**
 * Flush the observer report for a completed session (spec §4.4).
 *
 * @param {object} args
 * @param {number} args.jobId — observer_jobs.id for this session
 * @param {number} args.sessionId — interview_sessions.id
 * @returns {Promise<{ written: boolean, duplicate?: boolean, jobCompleted?: boolean, reason?: string }>}
 *   written=true  — row inserted (jobCompleted reports whether the job's
 *                    guarded `flushing → complete` transition also landed)
 *   duplicate=true — a report row already existed (first write won);
 *                    job completion attempted the same way
 *   reason        — why no write happened (consent / job state / no session)
 */
async function flushReport({ jobId, sessionId }) {
	const { rows } = await db.query(
		`SELECT id, status, config FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	const session = rows[0];
	if (!session) {
		return { written: false, reason: 'session_not_found' };
	}

	// Contract guard (privacy-engineer F2): this writer exists to report
	// on a COMPLETED session. The worker tick enforces it too, but the
	// writer must not depend on its caller — a premature flush of a live
	// session would, via ON CONFLICT DO NOTHING, make the empty skeleton
	// the permanent first write.
	if (session.status !== 'completed') {
		return { written: false, reason: 'session_not_completed' };
	}

	// AC-3 / AC-6 (revocation arm): re-check the gate at flush time, not
	// claim time. Consent revoked between session end and flush → no row.
	const gate = canEnableObserver(session);
	if (!gate.allowed) {
		return { written: false, reason: `consent_not_granted:${gate.code}` };
	}

	// Guarded lifecycle transition (AC-4). rowCount 0 means the job is
	// terminal or gone — e.g. erasure already deleted it (AC-6 erasure
	// arm) or a revocation cancelled it. Abort before opening a tx.
	const transitioned = await observerJobs.markFlushing(jobId);
	if (!transitioned) {
		return { written: false, reason: 'job_not_flushing' };
	}

	const { analysis, integrity_summary } = buildReportSkeleton(session);
	const roomName = session.config?.livekit_room || `session-${sessionId}`;
	const identity = `ai-observer-${sessionId}`;

	const client = await db.connect();
	try {
		await client.query('BEGIN');

		// AC-5: lock + re-check the job row inside the transaction. Gone
		// or no longer `flushing` (erasure deleted it, or a cancel landed
		// after markFlushing) → abort; writing would resurrect erased
		// data or report on a revoked session.
		const { rows: jobRows } = await client.query(
			`SELECT id, status FROM observer_jobs WHERE id = $1 FOR UPDATE`,
			[jobId],
		);
		if (!jobRows[0] || jobRows[0].status !== 'flushing') {
			await client.query('ROLLBACK');
			return { written: false, reason: 'job_aborted_in_tx' };
		}

		const { rowCount } = await client.query(
			`INSERT INTO ai_observer_reports
			   (interview_session_id, livekit_room_name, observer_identity,
			    analysis, integrity_summary, consent_state)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (interview_session_id) DO NOTHING`,
			[
				sessionId,
				roomName,
				identity,
				JSON.stringify(analysis),
				JSON.stringify(integrity_summary),
				'granted', // AC-3: explicit — never rely on the column DEFAULT
			],
		);

		await client.query('COMMIT');

		// Report is durable (inserted now, or first write already won).
		// Guarded complete: only lands if the job is still `flushing`.
		// Its outcome is surfaced, not discarded (privacy-engineer F3):
		// if a cancel landed post-commit, the row exists but the job is
		// `cancelled` — callers/logs must not claim a clean completion.
		const jobCompleted = (await observerJobs.complete(jobId)) === 1;

		return rowCount === 1
			? { written: true, jobCompleted }
			: { written: false, duplicate: true, jobCompleted };
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		client.release();
	}
}

module.exports = { flushReport, buildReportSkeleton };
