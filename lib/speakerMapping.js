/**
 * speakerMapping — Numbers → names mapping proposal
 * (S-D08, #1910; Architecture §3.7, ADR-D05, PRD FR-D08/D09/D10).
 *
 * Owns: the proposal and its persistence. Does NOT own: correction
 * (a human act, §5) or display (S-D09) — and it never analyses
 * transcript content. The proposal uses MEETING FACTS ONLY (BR-12
 * fence): who was in the call (interview_events, the linkage
 * canAccessRecording already trusts) plus per-speaker speaking share
 * and first-speaking order computed from the turns.
 *
 * The share/order figures are computed transiently inside
 * computeProposal and DISCARDED: they are never returned in a
 * persistable shape, never written to any column, and never exposed
 * by any API (AC-6, FR-D13/D21 deferral). Rows and the run's
 * proposed_mapping carry assignments only.
 *
 * The proposal never guesses (FR-D09): ambiguity stays unassigned
 * ("Speaker N") for the manual path (FR-D10, S-D10's editor). Two
 * refinements from the PR #1932 review (BLOCK, reconciled same-day):
 * the speaker set is built from assignable turns only (≥100 ms —
 * phantom speakers get no row and no name), and a tripped top-two
 * ambiguity guard voids ALL assignments, not just the top two.
 *
 * HA-2 degradation switch: DIARIZATION_AUTO_NAME (default ON,
 * server-side config, read fresh on every call). OFF skips the
 * proposal step entirely: every speaker stays unassigned and no
 * proposed_mapping is generated. Flipping it needs no code change
 * if Quinn's Phase 6 measurement trips HA-2. The OFF parsing is
 * deliberately WIDER than diarizationFlag's exact-'true' (#1934
 * M-4, Rex/Lead discussion on the issue): an enable flag fails
 * closed because OFF is its safe state, and this kill switch's
 * safe state is also OFF — so plausible OFF spellings (trimmed,
 * case-insensitive 'false'/'0'/'off'/'no') all land OFF, while
 * unset/'true'/unrecognised values keep the default ON.
 *
 * Presentation-only (BR-12): this module imports nothing from, and
 * is imported by nothing in, the OmniScore / Trust Score / matching
 * / screening code — the fence S-D14 machine-checks.
 */

// Top-two shares closer than this (in share points) are ambiguous:
// the candidate/interviewer order between them is a guess, so both
// stay unassigned (§3.7 rule 2). Boundary inclusive — a gap of
// exactly 0.10 is still ambiguous (conservative; Nova STOP 1 on
// #1910, probe evidence in the unit suite).
const AMBIGUITY_SHARE_GAP = 0.1;

// Assignable-turn floor (ms), mirroring transcriptStitch's
// MIN_ASSIGNABLE_TURN_MS (§3.6, #1929 M4): a shorter turn is engine
// noise, not a voice. The speaker set — and every share — is built
// from assignable turns ONLY, so a phantom sub-floor speaker never
// gains a mapping row and can never be proposed as a named person
// (review B-1 on PR #1932; Suga STOP 1 reading (c) on #1910). Kept
// as a local constant because transcriptStitch imports this module
// (a require back would be a cycle); the two must move together.
// Durations are computed in rounded integer ms, exactly like
// stitch's turnMs — in float seconds a genuine 100 ms turn at a
// non-zero offset (0.2 → 0.3) computes as 0.09999999999999998 and
// would be wrongly excluded here while stitch includes it
// (re-review N-1 on PR #1935).
const MIN_ASSIGNABLE_TURN_MS = 100;

// Speaker-number contract (#1934 M-3): recording_speaker_mappings.
// speaker_number is int4 (migration 296), and engine speaker labels
// are 0-based ordinals. A speaker outside [0, INT4_MAX] is not a
// voice this system can persist: a negative would persist as a
// meaningless label, and an over-int4 value fails the mapping
// INSERT and rolls back the entire stitch. computeProposal skips
// such turns, exactly as it already skips non-integers — the valid
// speaker set is defined HERE, in the pure function.
const INT4_MAX = 2147483647;

// HA-2 OFF set (#1934 M-4): trimmed, case-insensitive. Anything
// else — unset, 'true', unrecognised — keeps auto-naming ON (the
// documented default); garbage is not silently treated as OFF.
const AUTO_NAME_OFF_VALUES = new Set(['false', '0', 'off', 'no']);

function isAutoNameEnabled(env = process.env) {
	const raw = env.DIARIZATION_AUTO_NAME;
	if (raw == null) return true;
	return !AUTO_NAME_OFF_VALUES.has(String(raw).trim().toLowerCase());
}

/**
 * Participants of a call from its interview_events row (OQ-4):
 * candidate first-class, then the lead recruiter, then panel
 * members — ranked by expected speaking share (§3.7). Roles are
 * snapshotted here so a later role change never rewrites history.
 *
 * @param {{candidate_id?:number, recruiter_id?:number, panel_member_ids?:number[]}|null} event
 * @returns {Array<{userId:number, role:'candidate'|'interviewer'}>}
 */
function participantsFromEvent(event) {
	if (!event) return [];
	const seen = new Set();
	const out = [];
	const push = (userId, role) => {
		if (userId == null || seen.has(userId)) return;
		seen.add(userId);
		out.push({ userId, role });
	};
	push(event.candidate_id, 'candidate');
	push(event.recruiter_id, 'interviewer');
	for (const id of Array.isArray(event.panel_member_ids) ? event.panel_member_ids : []) {
		push(id, 'interviewer');
	}
	return out;
}

/**
 * The deterministic proposal (§3.7, ADR-D05). Pure — no DB, no env.
 *
 * @param {{turns:Array<{speaker:number,start_s:number,end_s:number}>,
 *          participants:Array<{userId:number,role:string}>,
 *          autoNameEnabled?:boolean}} args
 * @returns {{rows:Array<{speaker_number:number, participant_user_id:number|null,
 *            participant_role:string|null}>,
 *            proposedMapping:Object|null}}
 *   rows — one per distinct turn speaker, sorted by speaker number.
 *   proposedMapping — { "<speaker>": {participant_user_id,
 *   participant_role} | null } for diarization_runs.proposed_mapping;
 *   null when the proposal step was skipped (auto-name OFF).
 */
function computeProposal({ turns, participants, autoNameEnabled = true }) {
	const list = Array.isArray(turns) ? turns : [];
	const people = Array.isArray(participants) ? participants : [];

	// Per-speaker share + first-speaking order — internal only.
	// Assignable turns only (see MIN_ASSIGNABLE_TURN_MS): sub-floor
	// turns contribute neither a speaker nor share. First-speaking
	// order is chronological — the minimum start_s (review M-1 on
	// PR #1932: array order is the engine's emission order, which
	// §3.7 does not promise).
	const stats = new Map();
	let total = 0;
	for (const t of list) {
		// Speaker contract (#1934 M-3): integer within [0, INT4_MAX]
		// only — see the INT4_MAX note above.
		if (!t || !Number.isInteger(t.speaker) || t.speaker < 0 || t.speaker > INT4_MAX) continue;
		const dur = Math.max(0, Math.round((t.end_s || 0) * 1000) - Math.round((t.start_s || 0) * 1000));
		if (dur < MIN_ASSIGNABLE_TURN_MS) continue;
		if (!stats.has(t.speaker)) stats.set(t.speaker, { share: 0, first: t.start_s || 0 });
		const st = stats.get(t.speaker);
		st.share += dur;
		st.first = Math.min(st.first, t.start_s || 0);
		total += dur;
	}
	const speakers = [...stats.keys()];
	if (speakers.length === 0) {
		// No assignable speakers: nothing to propose. With auto-name
		// OFF the step was skipped, so the skipped signal (null) is
		// preserved even here (review M-2 on PR #1932).
		return { rows: [], proposedMapping: autoNameEnabled ? {} : null };
	}
	for (const s of speakers) {
		const st = stats.get(s);
		st.share = total > 0 ? st.share / total : 0;
	}
	const ranked = [...speakers].sort(
		(a, b) => stats.get(b).share - stats.get(a).share || stats.get(a).first - stats.get(b).first,
	);

	const assigned = new Map(); // speaker_number -> participant
	if (autoNameEnabled && people.length > 0) {
		if (ranked.length === 1) {
			// Rule 1: a lone voice is proposed only when exactly one
			// participant exists — in a multi-participant call a single
			// voice is NOT assumed to be the candidate (FR-D16).
			if (people.length === 1) assigned.set(ranked[0], people[0]);
		} else {
			// Rules 2–4: pair ranked speakers to ranked participants —
			// UNLESS the top-two ambiguity guard trips. Reconciled
			// reading (Suga ruling on PR #1932's review B-2, superseding
			// Nova STOP 1's "later pairs still pair"): when the top of
			// the ranking cannot be told apart, NO assignments are made
			// at all — every pairing below an ambiguous top rests on
			// the same untrustworthy ranking, and the zero-share probe
			// showed the alternative proposing a name on literally no
			// speaking evidence. The proposal never guesses (FR-D09).
			// Epsilon: 0.55 - 0.45 === 0.10000000000000003 in IEEE 754 —
			// without it the exact-boundary case the guard exists for
			// would slip through as "clear".
			const guardTripped =
				stats.get(ranked[0]).share - stats.get(ranked[1]).share <= AMBIGUITY_SHARE_GAP + 1e-9;
			if (!guardTripped) {
				// Auto-proposal is capped at the candidate + the lead
				// interviewer (privacy specialist finding (c) on #1910,
				// adopted by Suga): no meeting fact distinguishes one
				// panel interviewer from another — panel_member_ids
				// order is not evidence — so naming a specific panel
				// member by share rank would be a guess presented as an
				// assignment. Panel speakers stay unassigned for manual
				// mapping (FR-D10). This narrows §3.7 rule 2's
				// assign-in-order for the exact-count case; recorded as
				// a deviation on #1910 for Rex to ratify or overrule in
				// the architecture doc.
				const slots = Math.min(ranked.length, people.length, 2);
				for (let i = 0; i < slots; i++) {
					assigned.set(ranked[i], people[i]);
				}
			}
		}
	}

	const rows = [...speakers]
		.sort((a, b) => a - b)
		.map((speaker) => {
			const p = assigned.get(speaker);
			return {
				speaker_number: speaker,
				participant_user_id: p ? p.userId : null,
				participant_role: p ? p.role : null,
			};
		});

	if (!autoNameEnabled) return { rows, proposedMapping: null };
	const proposedMapping = {};
	for (const r of rows) {
		proposedMapping[String(r.speaker_number)] = r.participant_user_id
			? { participant_user_id: r.participant_user_id, participant_role: r.participant_role }
			: null;
	}
	return { rows, proposedMapping };
}

/**
 * Participants of a recording from its FROZEN set (S-D19, #1956;
 * br7-panel-notice-design.md §13 item 7, security S-4): the mapping-
 * correction validation source is the recording's frozen expected set
 * (panel_expected_user_ids, frozen at recording creation by S-D18)
 * ∪ candidate ∪ recruiter, AS FROZEN — an assignee valid when the
 * recording was made stays valid, and a user added to the event
 * afterwards does NOT become assignable to a recording they were
 * never a captured speaker on. Returns null when the recording has
 * no freeze (pre-299 recording): callers fall back to the event's
 * current lists for those legacy rows, since no freeze existed when
 * they were made.
 *
 * @param {{panel_expected_user_ids?:number[]|null}|null} recording
 * @param {{candidate_id?:number, recruiter_id?:number}|null} event
 * @returns {Array<{userId:number, role:'candidate'|'interviewer'}>|null}
 */
function participantsFromFrozenSet(recording, event) {
	if (!event || !recording || !Array.isArray(recording.panel_expected_user_ids)) return null;
	const out = [];
	const seen = new Set();
	const push = (userId, role) => {
		if (userId == null || seen.has(userId)) return;
		seen.add(userId);
		out.push({ userId, role });
	};
	push(event.candidate_id, 'candidate');
	// The frozen set already excludes the candidate and includes the
	// recruiter + panel as frozen; union with recruiter is defensive.
	push(event.recruiter_id, 'interviewer');
	for (const id of [...recording.panel_expected_user_ids].sort((a, b) => a - b)) {
		push(id, 'interviewer');
	}
	return out;
}

/**
 * Load a recording's participants on an existing transaction client
 * (the stitch's — §4.3 step 4). No resolvable event row → [] (AC-4).
 */
async function loadParticipants(client, interviewEventId) {
	if (interviewEventId == null) return [];
	const res = await client.query(
		`SELECT candidate_id, recruiter_id, panel_member_ids FROM interview_events WHERE id = $1`,
		[interviewEventId],
	);
	if (res.rows.length === 0) return [];
	return participantsFromEvent(res.rows[0]);
}

/** Persist proposal rows on the caller's transaction client. */
async function persistMappings(client, recordingId, rows) {
	for (const r of rows) {
		await client.query(
			`INSERT INTO recording_speaker_mappings
			   (recording_id, speaker_number, participant_user_id, participant_role, state)
			 VALUES ($1, $2, $3, $4, 'proposed')`,
			[recordingId, r.speaker_number, r.participant_user_id, r.participant_role],
		);
	}
}

module.exports = {
	AMBIGUITY_SHARE_GAP,
	INT4_MAX,
	isAutoNameEnabled,
	participantsFromEvent,
	participantsFromFrozenSet,
	computeProposal,
	loadParticipants,
	persistMappings,
};
