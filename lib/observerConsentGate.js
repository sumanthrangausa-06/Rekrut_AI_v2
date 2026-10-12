/**
 * observerConsentGate — S-070 (#724), amended S-046 (#694): AI Observer consent gate (Option A).
 *
 * Single choke point for the observer consent decision. The AI observer may
 * join a session ONLY when the candidate explicitly granted biometric
 * collection (biometric_collection === true on the session config).
 *
 * Default-deny amendment (privacy-engineer BLOCKER, E-008 spec §3.1,
 * Sumanth-approved 2026-10-12): for biometric processing, "not declined"
 * is NOT consent. BIPA requires a written release BEFORE collection;
 * GDPR Art. 9 requires EXPLICIT opt-in. The previous `!== false` semantics
 * allowed the observer on unknown/unset consent — a per-interview liability
 * event under BIPA ($1k–$5k per violation, private right of action).
 *
 * Consent states:
 * - granted (=== true)  → allowed
 * - declined (=== false) → blocked, BIOMETRIC_CONSENT_DECLINED
 * - unknown (undefined/null/non-boolean, incl. null session) → blocked,
 *   BIOMETRIC_CONSENT_UNKNOWN (consent never presented, legacy session,
 *   config drift)
 *
 * Option A (Sumanth decision 2026-10-10, per Rex's architecture §3.19):
 * structural guarantee — the observer never receives the candidate's
 * streams, so it cannot process them. No per-module discipline required.
 *
 * Pure function: no DB, no side effects. Called at every observer
 * dispatch entry point (observer/enable route, livekit dispatch route,
 * S-047 worker claim/pre-subscribe/mid-session checks).
 * Easily testable in isolation.
 */

const GATE_BLOCKED_CODE = 'BIOMETRIC_CONSENT_DECLINED';
const GATE_UNKNOWN_CODE = 'BIOMETRIC_CONSENT_UNKNOWN';

/**
 * Evaluate whether the AI observer may be enabled for a session.
 *
 * @param {object|null|undefined} session — interview_sessions row (needs .config).
 *   Null/undefined sessions are blocked (fail-closed): without a session
 *   there is no verifiable explicit consent. Routes 404 on missing sessions
 *   before reaching the gate; the worker treats unloadable sessions the same.
 * @returns {{ allowed: true } | { allowed: false, code: string, message: string }}
 */
function canEnableObserver(session) {
	const flag = session?.config?.biometric_collection;

	if (flag === true) {
		return { allowed: true };
	}

	if (flag === false) {
		return {
			allowed: false,
			code: GATE_BLOCKED_CODE,
			message:
				'The candidate declined biometric analysis for this session, so the AI observer cannot be enabled.',
		};
	}

	// Default-deny: undefined, null, or non-boolean (consent never presented,
	// legacy session, config drift) — "not declined" is not consent.
	return {
		allowed: false,
		code: GATE_UNKNOWN_CODE,
		message:
			'Biometric consent status is unknown for this session — the candidate has not granted explicit consent, so the AI observer cannot be enabled.',
	};
}

module.exports = { canEnableObserver, GATE_BLOCKED_CODE, GATE_UNKNOWN_CODE };
