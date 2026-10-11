/**
 * observerConsentGate — S-070 (#724): AI Observer consent gate (Option A).
 *
 * Single choke point for the observer consent decision. When a candidate
 * declined biometric collection (biometric_collection === false on the
 * session config), the AI observer must NOT join the room — no job
 * enqueued, no audio/video streams received.
 *
 * Option A (Sumanth decision 2026-10-10, per Rex's architecture §3.19):
 * structural guarantee — the observer never receives the candidate's
 * streams, so it cannot process them. No per-module discipline required.
 *
 * Pure function: no DB, no side effects. Called at every observer
 * dispatch entry point (observer/enable route, livekit dispatch route).
 * Easily testable in isolation.
 */

const GATE_BLOCKED_CODE = 'BIOMETRIC_CONSENT_DECLINED';

/**
 * Evaluate whether the AI observer may be enabled for a session.
 *
 * @param {object|null|undefined} session — interview_sessions row (needs .config).
 *   Null/undefined sessions are allowed here: routes 404 on missing
 *   sessions before reaching the gate. The gate only blocks on an
 *   explicit biometric decline.
 * @returns {{ allowed: true } | { allowed: false, code: string, message: string }}
 */
function canEnableObserver(session) {
	if (session?.config?.biometric_collection === false) {
		return {
			allowed: false,
			code: GATE_BLOCKED_CODE,
			message:
				'The candidate declined biometric analysis for this session, so the AI observer cannot be enabled.',
		};
	}
	return { allowed: true };
}

module.exports = { canEnableObserver, GATE_BLOCKED_CODE };
