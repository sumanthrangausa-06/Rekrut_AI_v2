/**
 * humanInterviewService — S-012 (#651): Consent-decline → human interview path.
 *
 * Flow:
 *   1. Candidate declines biometric consent (S-010 AC-4 offer, S-011 receipt)
 *      and confirms the human-interview offer.
 *   2. requestHumanInterview(): verifies the decline, records the request,
 *      notifies the recruiter (AC-1).
 *   3. respondToRequest(): recruiter approves → a human-mode session is
 *      created with biometric_collection: false (AC-2, AC-3); recruiter
 *      declines → the candidate is notified (AC-2).
 *
 * S-010 owns the UI. This module owns the backend workflow.
 *
 * Concurrency: the UNIQUE(session_id) constraint makes duplicate requests
 * fail atomically at the DB level; the status check + update in
 * respondToRequest uses a single guarded UPDATE (same pattern as S-003).
 */

const db = require('./db');
const consentService = require('./consentService');
const { notifyUser } = require('./notify');
const SessionService = require('./sessionService');
// Single source for the hiring-team gate (fail-closed, same as S-001).
const HIRING_ROLES = SessionService.HIRING_ROLES;

function _codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

const humanInterviewService = {
	/**
	 * Candidate requests a human interview after declining biometric consent.
	 * @param {{sessionId: number, candidateId: number}}
	 * @returns {Promise<object>} the created request row
	 * @throws BIOMETRIC_CONSENT_NOT_DECLINED (409) — precondition not met
	 * @throws REQUEST_ALREADY_EXISTS (409) — one request per session
	 * @throws SESSION_NOT_FOUND / FORBIDDEN — from ownership checks
	 */
	async requestHumanInterview({ sessionId, candidateId }) {
		// The session must belong to the caller (prevents request planting).
		await consentService.assertSessionOwnership(sessionId, candidateId);

		const { rows: sessionRows } = await db.query(
			`SELECT s.id, s.candidate_id, s.triggered_by, s.company_id, j.title AS job_title
       FROM interview_sessions s LEFT JOIN jobs j ON j.id = s.job_id
       WHERE s.id = $1`,
			[sessionId],
		);
		if (sessionRows.length === 0) {
			throw _codedError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
		}
		const session = sessionRows[0];

		// AC-1 precondition: the candidate declined biometric consent.
		const status = await consentService.getConsentStatus(sessionId);
		if (!status.biometric || !status.biometric.withdrawn) {
			throw _codedError(
				'BIOMETRIC_CONSENT_NOT_DECLINED',
				'Human interview requests require a declined biometric consent receipt',
			);
		}

		// One request per session — the UNIQUE constraint is the atomic guard;
		// the pre-check gives a clean 409 instead of a 500 on race.
		const { rows: existing } = await db.query(
			'SELECT id, status FROM human_interview_requests WHERE session_id = $1',
			[sessionId],
		);
		if (existing.length > 0) {
			throw _codedError(
				'REQUEST_ALREADY_EXISTS',
				`A human interview request already exists for session ${sessionId}`,
			);
		}

		let requestRow;
		try {
			const { rows } = await db.query(
				`INSERT INTO human_interview_requests (session_id, candidate_id, recruiter_id, status)
         VALUES ($1, $2, $3, 'pending') RETURNING *`,
				[sessionId, candidateId, session.triggered_by],
			);
			requestRow = rows[0];
		} catch (err) {
			// Race: UNIQUE(session_id) fired between the check and the insert.
			if (err.code === '23505') {
				throw _codedError(
					'REQUEST_ALREADY_EXISTS',
					`A human interview request already exists for session ${sessionId}`,
				);
			}
			throw err;
		}

		// AC-1: notify the recruiter (session creator). Best-effort — notifyUser
		// never throws, so a notification failure can't break the request.
		// Copy reviewed by UX architect (2026-10-10): the accommodation request
		// leads; the opt-out is neutral context (avoids bias-framing the
		// candidate by their refusal).
		const recruiterMessage = session.job_title
			? `A candidate has requested a human interview as an alternative to the biometric screening for ${session.job_title}. Please review the request in your dashboard.`
			: 'A candidate has requested a human interview as an alternative to the biometric screening. Please review the request in your dashboard.';
		await notifyUser(
			session.triggered_by,
			'human_interview_requested',
			'Human interview requested',
			recruiterMessage,
			{ request_id: requestRow.id, session_id: sessionId, candidate_id: candidateId },
		);

		return requestRow;
	},

	/**
	 * Recruiter approves or declines a pending human interview request.
	 * @param {{requestId: number, recruiterId: number, recruiterRole: string, recruiterCompanyId?: number, approved: boolean}}
	 * @returns {Promise<object>} the updated request row
	 * @throws REQUEST_NOT_FOUND / FORBIDDEN / REQUEST_ALREADY_DECIDED (409)
	 */
	async respondToRequest({ requestId, recruiterId, recruiterRole, recruiterCompanyId, approved }) {
		const { rows } = await db.query(
			`SELECT r.*, s.company_id, s.job_id, s.application_id, c.name AS company_name
       FROM human_interview_requests r
       JOIN interview_sessions s ON s.id = r.session_id
       LEFT JOIN companies c ON c.id = s.company_id
       WHERE r.id = $1`,
			[requestId],
		);
		if (rows.length === 0) {
			throw _codedError('REQUEST_NOT_FOUND', `Human interview request ${requestId} not found`);
		}
		const reqRow = rows[0];

		// Only the notified recruiter (or their hiring team) may decide.
		const isAssignedRecruiter = recruiterId === reqRow.recruiter_id;
		const isHiringTeam =
			HIRING_ROLES.includes(recruiterRole) &&
			(recruiterRole === 'admin' || recruiterCompanyId === reqRow.company_id);
		if (!isAssignedRecruiter && !isHiringTeam) {
			throw _codedError('FORBIDDEN', 'Only the hiring team can respond to this request');
		}

		if (reqRow.status !== 'pending') {
			throw _codedError(
				'REQUEST_ALREADY_DECIDED',
				`Request ${requestId} was already ${reqRow.status}`,
			);
		}

		let humanSession = null;
		if (approved) {
			// AC-2 + AC-3: create the human session with biometric collection
			// disabled. SessionService.create enforces hiring-team-only
			// human scheduling (fail-closed, S-001).
			humanSession = await SessionService.create({
				type: 'human',
				triggeredBy: recruiterId,
				companyId: reqRow.company_id,
				jobId: reqRow.job_id,
				applicationId: reqRow.application_id,
				candidateId: reqRow.candidate_id,
				config: { biometric_collection: false },
				callerRole: recruiterRole,
			});
		}

		// Atomic: the status guard in WHERE makes a double-decide a no-op row
		// (same pattern as S-003 transitions).
		const { rows: updated } = await db.query(
			`UPDATE human_interview_requests
       SET status = $2, decided_at = NOW(), decided_by = $3
       WHERE id = $1 AND status = 'pending' RETURNING *`,
			[requestId, approved ? 'approved' : 'declined', recruiterId],
		);
		if (updated.length === 0) {
			throw _codedError(
				'REQUEST_ALREADY_DECIDED',
				`Request ${requestId} was decided concurrently`,
			);
		}

		// AC-2: notify the candidate of the outcome. Best-effort.
		// Copy reviewed by UX architect (2026-10-10): the approval confirms the
		// one thing the candidate asked for (no biometric collection); the
		// decline is honest without overpromising.
		const approver = reqRow.company_name ? `the team at ${reqRow.company_name}` : 'the recruiter';
		const decliner = reqRow.company_name
			? `The team at ${reqRow.company_name}`
			: 'The recruiter';
		if (approved) {
			await notifyUser(
				reqRow.candidate_id,
				'human_interview_approved',
				'Human interview approved',
				`Good news — ${approver} approved your human interview request. No biometric data will be collected for this interview. You'll find the schedule on your Sessions page.`,
				{ request_id: requestId, session_id: humanSession.id },
			);
		} else {
			await notifyUser(
				reqRow.candidate_id,
				'human_interview_declined',
				'Human interview request update',
				`${decliner} isn't able to offer a human interview for this role. Your application remains on file, and we'll reach out if another opportunity fits.`,
				{ request_id: requestId },
			);
		}

		return updated[0];
	},
};

module.exports = humanInterviewService;
