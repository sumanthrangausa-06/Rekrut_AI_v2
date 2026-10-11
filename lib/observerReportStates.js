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
		'The candidate declined biometric collection for this session, so the AI observer was not enabled and no biometric analysis was performed for this section.',
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
 * @param {object} args
 * @param {object|null|undefined} args.session — interview_sessions row (needs .config).
 *   Null/undefined sessions are allowed: without consent evidence the section
 *   is "missing", never "declined". Only an explicit biometric decline
 *   (config.biometric_collection === false) produces the declined state.
 * @param {string} args.section — report section key ('vocal' | 'visual' | 'integrity' | …).
 * @param {boolean} args.hasData — whether the report has data for this section.
 * @returns {{ state: 'present'|'missing'|'declined', label?: string, explanation?: string }}
 */
function getSectionState({ session, section, hasData }) {
	if (hasData) {
		return { state: SECTION_STATES.PRESENT };
	}
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
	return { state: SECTION_STATES.MISSING };
}

/**
 * Resolve states for every biometric section of a session's observer report.
 *
 * @param {object} args
 * @param {object|null|undefined} args.session — interview_sessions row (needs .config).
 * @param {Record<string, boolean>} [args.dataBySection] — hasData per section key.
 * @returns {Record<string, { state: string, label?: string, explanation?: string }>}
 */
function getReportSectionStates({ session, dataBySection = {} }) {
	const states = {};
	for (const section of BIOMETRIC_SECTIONS) {
		states[section] = getSectionState({
			session,
			section,
			hasData: Boolean(dataBySection[section]),
		});
	}
	return states;
}

module.exports = {
	getSectionState,
	getReportSectionStates,
	SECTION_STATES,
	BIOMETRIC_SECTIONS,
	DECLINED_COPY,
};
