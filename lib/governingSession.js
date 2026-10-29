/**
 * governingSession — the event→session bridge, write side (#1925,
 * ADR-D06; design §4 in docs/sdlc/rekrut-ai-v2/03-solutioning/
 * speaker-labelled-transcripts/event-session-bridge-design.md).
 *
 * Every human-interview event gets ONE governing session, created for
 * that event, against which the candidate's biometric consent for
 * THAT interview is captured and the diarization gate checks. This
 * module is the only creator of that link:
 *
 *   - creation only — an existing session is NEVER adopted/inferred;
 *   - an existing link is never overwritten (the link UPDATE carries
 *     `interview_session_id IS NULL`; a lost race re-reads the winner);
 *   - consent starts refused-by-default: the session is created with
 *     config { biometric_collection: false } and creation grants
 *     nothing — a grant exists only when the candidate records it
 *     against this session via consentService.recordConsent (§4.4).
 *
 * SessionService.create enforces hiring-team-only creation for human
 * sessions, so callers pass the acting recruiter's role; a candidate
 * can never create a governing session.
 */

const db = require('./db');
const SessionService = require('./sessionService');

/**
 * Return the event's governing session id, creating and linking it
 * first when the event has none.
 *
 * @param {object} event - an interview_events row (needs id,
 *   candidate_id, job_application_id, recruiter_id; interview_session_id
 *   may be null/absent)
 * @param {object} opts
 * @param {string} opts.callerRole - acting user's role (hiring team)
 * @param {object} [opts.executor] - query executor ({ query }); pass a
 *   transaction client at event creation so event + session + link
 *   land in ONE transaction (design §4.1). Defaults to the shared pool.
 * @returns {Promise<number>} the governing session id
 */
async function ensureGoverningSession(event, { callerRole, executor } = {}) {
	if (event.interview_session_id) {
		return event.interview_session_id;
	}
	const queryable = executor || db;

	let companyId = null;
	let jobId = null;
	if (event.job_application_id) {
		const jaRes = await queryable.query(
			`SELECT ja.job_id, j.company_id AS job_company_id
			 FROM job_applications ja JOIN jobs j ON ja.job_id = j.id
			 WHERE ja.id = $1`,
			[event.job_application_id],
		);
		if (jaRes.rows[0]) {
			jobId = jaRes.rows[0].job_id;
			companyId = jaRes.rows[0].job_company_id;
		}
	}

	const session = await SessionService.create(
		{
			type: 'human',
			triggeredBy: event.recruiter_id,
			companyId,
			jobId,
			applicationId: event.job_application_id || null,
			candidateId: event.candidate_id,
			config: { biometric_collection: false },
			callerRole,
		},
		queryable,
	);

	// Link — guarded so a concurrent creator wins instead of being
	// overwritten (creation, never adoption, applies to OUR session
	// too once another creator has linked theirs first).
	const linkRes = await queryable.query(
		`UPDATE interview_events SET interview_session_id = $1, updated_at = NOW()
		 WHERE id = $2 AND interview_session_id IS NULL
		 RETURNING interview_session_id`,
		[session.id, event.id],
	);
	if (linkRes.rows[0]) {
		return linkRes.rows[0].interview_session_id;
	}
	const reRead = await queryable.query(
		`SELECT interview_session_id FROM interview_events WHERE id = $1`,
		[event.id],
	);
	return reRead.rows[0]?.interview_session_id ?? session.id;
}

module.exports = { ensureGoverningSession };
