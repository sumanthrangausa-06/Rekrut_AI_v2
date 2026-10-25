/**
 * observerReportStates — S-071 (#725): Observer report section states.
 *
 * Convention module for the AI Observer report subsystem (E-008, not yet
 * built). When a candidate declined biometric collection (biometric_collection
 * === false on the session config, enforced by S-070's observerConsentGate),
 * the observer never joined — so the report's biometric sections must render
 * as "declined", a DISTINCT state from "missing". A blank section or
 * "data missing" reads as a bug; "Declined by candidate" tells the recruiter
 * exactly why the section is empty (AC-1, AC-2).
 *
 * The declined state is DERIVED FROM CONSENT, not from row absence: a declined
 * session has no observer rows at all (the observer never ran). Row absence
 * alone would read as "missing". Only an explicit biometric decline produces
 * "declined".
 *
 * Pure functions: no DB, no side effects. When the observer report subsystem
 * is built, it MUST resolve every section through getSectionState /
 * getReportSectionStates so declined sessions render correctly. Frontend
 * renderers should mirror DECLINED_COPY verbatim for copy consistency.
 *
 * S-039 (#686) amendments (panel rulings, Sumanth-approved 2026-10-12):
 * - Resolution order is consent → disclosure scope → presence
 *   (getSectionState gained `inDisclosureScope`).
 * - DECLINED_COPY's explanation now carries the no-inference clause
 *   atomically — where a decline is named (candidate surfaces, the
 *   hiring-team-gated audit record), the clause travels with it.
 * - The recruiter-facing surface never names a candidate-side non-consent
 *   reason: getRecruiterObserverNotice collapses declined / withdrawn /
 *   unknown to one neutral sentence. See the audience-split note on
 *   RECRUITER_NEUTRAL_COPY below.
 */

const SECTION_STATES = {
	/** Section has data. */
	PRESENT: 'present',
	/** No data, and consent was NOT declined (e.g. observer error, partial run). */
	MISSING: 'missing',
	/** Candidate declined biometric collection — S-071 state. */
	DECLINED: 'declined',
};

/**
 * Biometric-dependent sections of the observer report. All three require the
 * candidate's biometric consent; when declined, all three render "declined".
 * Non-biometric sections (e.g. transcript) are unaffected by a decline.
 */
const BIOMETRIC_SECTIONS = ['vocal', 'visual', 'integrity'];

/**
 * Canonical copy for the declined state. Keep in sync with frontend renderers.
 * UX architect review (S-071): label approved verbatim; explanation uses
 * "biometric collection" (the consent language) and "not enabled" (matches
 * the S-070 structural guarantee — the gate never ran). It promises only
 * that no AI biometric analysis was performed — never a claim about video
 * recording in the human interview.
 */
const DECLINED_COPY = {
	label: 'Declined by candidate',
	explanation:
		'The candidate declined biometric collection for this session, so the AI observer was not enabled and no biometric analysis was performed for this section. Declining is the candidate\u2019s right: it must not be held against them or influence the hiring decision.',
};

/**
 * Rendering guidance for the future observer report renderer (UX architect, S-071):
 * - role="status" with aria-describedby on the explanation — NOT role="alert";
 *   a decline is not an error and must not be announced like one.
 * - Neutral icon (person/hand or "not applicable") — never a warning triangle
 *   or error X, which frames the candidate's lawful choice as a failure.
 * - Informational/neutral color, visually distinct from both the grey
 *   "Insufficient data" badge and any red error state.
 * - Always pair the label with the explanation (subtext or "Why?" expander);
 *   the label alone could be misread as "the candidate declined the interview".
 */

/**
 * Resolve the display state for one observer report section.
 *
 * Resolution order (S-039 panel amendment to the S-082 §4 contract):
 * **consent → disclosure scope → presence**. A declined session resolves
 * to "declined" even if data somehow exists — surfacing biometric
 * analysis a candidate declined would itself be a consent violation.
 * A section outside the caller's disclosure scope resolves to "missing",
 * indistinguishable from genuinely absent data (suppression is never a
 * distinct visible state). Only then does presence apply.
 *
 * @param {object} args
 * @param {object|null|undefined} args.session — interview_sessions row (needs .config).
 *   Null/undefined sessions are allowed: without consent evidence the section
 *   is "missing", never "declined". Only an explicit biometric decline
 *   (config.biometric_collection === false) produces the declined state.
 * @param {string} args.section — report section key ('vocal' | 'visual' | 'integrity' | …).
 * @param {boolean} args.hasData — whether the report has data for this section.
 * @param {boolean} [args.inDisclosureScope=false] — whether this section is
 *   inside the requesting audience's disclosure scope. FAIL-CLOSED
 *   (privacy review, S-039): there is no permissive default — a caller
 *   that omits the flag gets suppression (`missing`), the same posture
 *   as the consent gate's default-deny. Callers opt into scope
 *   explicitly; the full scope evaluator is a S-049b AC.
 * @returns {{ state: 'present'|'missing'|'declined', label?: string, explanation?: string }}
 */
function getSectionState({ session, section, hasData, inDisclosureScope = false }) {
	if (
		BIOMETRIC_SECTIONS.includes(section) &&
		session?.config?.biometric_collection === false
	) {
		return {
			state: SECTION_STATES.DECLINED,
			label: DECLINED_COPY.label,
			explanation: DECLINED_COPY.explanation,
		};
	}
	if (inDisclosureScope === false) {
		return { state: SECTION_STATES.MISSING };
	}
	if (hasData) {
		return { state: SECTION_STATES.PRESENT };
	}
	return { state: SECTION_STATES.MISSING };
}

/**
 * Resolve states for every biometric section of a session's observer report.
 *
 * @param {object} args
 * @param {object|null|undefined} args.session — interview_sessions row (needs .config).
 * @param {Record<string, boolean>} [args.dataBySection] — hasData per section key.
 * @param {boolean} [args.inDisclosureScope=false] — see getSectionState (fail-closed).
 * @returns {Record<string, { state: string, label?: string, explanation?: string }>}
 */
function getReportSectionStates({ session, dataBySection = {}, inDisclosureScope = false }) {
	const states = {};
	for (const section of BIOMETRIC_SECTIONS) {
		states[section] = getSectionState({
			session,
			section,
			hasData: Boolean(dataBySection[section]),
			inDisclosureScope,
		});
	}
	return states;
}

/**
 * Canonical copy for the recruiter-facing report surface (S-039 audience
 * split, panel ruling, Sumanth-approved 2026-10-12).
 *
 * On the recruiter surface, candidate-side non-consent — declined,
 * withdrawn, or unknown — collapses to ONE neutral, indistinguishable
 * sentence (RECRUITER_NEUTRAL_COPY) placed in report metadata, never in
 * the assessment column and never naming the reason: a named decline in
 * a decision document invites exactly the inference the clause forbids,
 * and a protective clause appended to a named reason does not survive
 * a screenshot. Where the reason IS named (candidate-facing surfaces and
 * the hiring-team-gated audit record), DECLINED_COPY above is the copy —
 * its no-inference clause is part of the canonical string, never appended
 * by a renderer. Employer-disabled is the employer's own act and is named
 * as such (OBSERVER_DISABLED_COPY, S-039 AC-3 verbatim).
 */
const RECRUITER_NEUTRAL_COPY =
	'AI Observer analysis not available for this interview — no inference should be drawn from its absence.';

/** Employer disabled / never enabled the observer (S-039 AC-3, verbatim). */
const OBSERVER_DISABLED_COPY = 'AI Observer was not enabled for this session.';

/** Observer was present with consent; no analysis is included (panel Q4). */
const OBSERVER_PRESENCE_COPY =
	'AI Observer was present with candidate consent. No analysis is included in this report.';

/**
 * Resolve the metadata notice for the recruiter-facing report.
 *
 * Precedence mirrors the report's semantics: the employer's own act
 * (disabled) is named first; a present section means the analysis column
 * speaks for itself (no notice); granted consent with no analysis yet is
 * the presence line; everything else is candidate-side non-consent and
 * collapses to the neutral sentence — declined, withdrawn, and unknown
 * produce the IDENTICAL notice (panel test T-16).
 *
 * @param {object} args
 * @param {boolean} args.observerEnabled — session config observer_enabled.
 * @param {boolean} args.consentGranted — explicit biometric consent granted
 *   (or a granted report row exists).
 * @param {boolean} args.anySectionPresent — any section resolved `present`.
 * @returns {{ kind: 'disabled'|'none'|'presence'|'neutral', copy: string|null }}
 */
function getRecruiterObserverNotice({ observerEnabled, consentGranted, anySectionPresent }) {
	if (!observerEnabled) {
		return { kind: 'disabled', copy: OBSERVER_DISABLED_COPY };
	}
	if (anySectionPresent) {
		return { kind: 'none', copy: null };
	}
	if (consentGranted) {
		return { kind: 'presence', copy: OBSERVER_PRESENCE_COPY };
	}
	return { kind: 'neutral', copy: RECRUITER_NEUTRAL_COPY };
}

module.exports = {
	getSectionState,
	getReportSectionStates,
	getRecruiterObserverNotice,
	SECTION_STATES,
	BIOMETRIC_SECTIONS,
	DECLINED_COPY,
	RECRUITER_NEUTRAL_COPY,
	OBSERVER_DISABLED_COPY,
	OBSERVER_PRESENCE_COPY,
};
