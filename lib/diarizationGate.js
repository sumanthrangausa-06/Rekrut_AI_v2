/**
 * diarizationGate — the diarization consent gate (S-D04, #1906;
 * Architecture §3.4 step 1–3, §6.1 BR-2/BR-3).
 *
 * One evaluation, used at BOTH claim time and write time by the
 * diarization worker: each call re-resolves everything live, so the
 * value that governs is always the value at the moment of the call
 * (AC-5 — never enqueue-time, never a cache, never a client field).
 *
 * Steps, in order, all before any audio is touched:
 *   1. Recording → interview_session_id. No link (or no recording, or
 *      no session row) → NO_SESSION: no verifiable consent, the same
 *      default-deny as canEnableObserver on a null session.
 *      SCHEMA NOTE (deviation flagged on #1906): migration 130's
 *      chk_interview_recordings_source makes a recording event-linked
 *      XOR session-linked, and no event→session bridge exists — so
 *      today's event-linked human recordings always land here. That
 *      is the design's letter (§3.4 step 1) and it is fail-closed;
 *      diarization stays off for them until a bridge story links
 *      human interviews to sessions. See the PR body.
 *   2. consentService.checkConsentState(sessionId, 'biometric',
 *      candidateId) — live DB. Candidate resolution follows the house
 *      pattern (livekitService.resolveRecordingCandidateId):
 *      interview_sessions.candidate_id for session-linked recordings,
 *      falling back to interview_events.candidate_id when the session
 *      carries none (candidate-binding is the IDOR guard inside
 *      consentService). No resolvable candidate → NO_SESSION.
 *      Anything other than granted-and-current blocks: missing (which
 *      is also how consentService surfaces a decline — a decline is
 *      recorded as never-granted), withdrawn, version-stale. A throwing
 *      check blocks too (CONSENT_UNVERIFIABLE) — fail-closed.
 *   3. canEnableObserver(session) — the session-config projection of
 *      the same consent (S-070 propagation) as a second, independent
 *      check, so diarization and the Observer can never disagree about
 *      a candidate's biometric posture. Tier 0 objection (config false)
 *      and Tier 1+2 posture (config unset) block here by construction
 *      even if a DB receipt were somehow valid.
 */
const db = require('./db');
const consentService = require('./consentService');
const { canEnableObserver } = require('./observerConsentGate');

const STATE_TO_CODE = {
	missing: 'CONSENT_MISSING',
	withdrawn: 'CONSENT_WITHDRAWN',
	stale: 'CONSENT_VERSION_STALE',
};

/**
 * @param {number} recordingId - interview_recordings.id
 * @returns {Promise<{allowed: true, sessionId: number, candidateId: number}
 *   | {allowed: false, code: string}>}
 */
async function evaluateDiarizationGate(recordingId) {
	const recRes = await db.query(
		`SELECT interview_session_id, interview_event_id FROM interview_recordings WHERE id = $1`,
		[recordingId],
	);
	const recording = recRes.rows[0];
	if (!recording || !recording.interview_session_id) {
		return { allowed: false, code: 'NO_SESSION' };
	}
	const sessionId = recording.interview_session_id;

	const sessRes = await db.query(
		`SELECT id, config, candidate_id FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	const session = sessRes.rows[0];
	if (!session) {
		return { allowed: false, code: 'NO_SESSION' };
	}

	let candidateId = session.candidate_id ?? null;
	if (candidateId == null && recording.interview_event_id) {
		const evRes = await db.query(
			`SELECT candidate_id FROM interview_events WHERE id = $1`,
			[recording.interview_event_id],
		);
		candidateId = evRes.rows[0]?.candidate_id ?? null;
	}
	if (candidateId == null) {
		return { allowed: false, code: 'NO_SESSION' };
	}

	let state;
	try {
		state = await consentService.checkConsentState(sessionId, 'biometric', candidateId);
	} catch {
		// Fail-closed: consent that cannot be verified is not consent.
		return { allowed: false, code: 'CONSENT_UNVERIFIABLE' };
	}
	if (state.state !== 'valid') {
		return { allowed: false, code: STATE_TO_CODE[state.state] || 'CONSENT_UNVERIFIABLE' };
	}

	const observerGate = canEnableObserver(session);
	if (!observerGate.allowed) {
		return { allowed: false, code: observerGate.code };
	}

	return { allowed: true, sessionId, candidateId };
}

module.exports = { evaluateDiarizationGate };
