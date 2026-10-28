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
 * ("Speaker N") for the manual path (FR-D10, S-D10's editor).
 *
 * HA-2 degradation switch: DIARIZATION_AUTO_NAME (default ON,
 * server-side config, read fresh on every call). OFF — the exact
 * string 'false' — skips the proposal step entirely: every speaker
 * stays unassigned and no proposed_mapping is generated. Flipping it
 * needs no code change if Quinn's Phase 6 measurement trips HA-2.
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

function isAutoNameEnabled(env = process.env) {
	return env.DIARIZATION_AUTO_NAME !== 'false';
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
	const stats = new Map();
	let total = 0;
	for (const t of list) {
		if (!Number.isInteger(t.speaker)) continue;
		const dur = Math.max(0, (t.end_s || 0) - (t.start_s || 0));
		if (!stats.has(t.speaker)) stats.set(t.speaker, { share: 0, first: stats.size });
		stats.get(t.speaker).share += dur;
		total += dur;
	}
	const speakers = [...stats.keys()];
	if (speakers.length === 0) return { rows: [], proposedMapping: {} };
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
			// Rules 2–4: pair ranked speakers to ranked participants.
			// The top-two ambiguity guard leaves BOTH top speakers and
			// BOTH top participant slots unassigned; later ranked pairs
			// still pair in order (their ranking is not in doubt).
			let start = 0;
			// Epsilon: 0.55 - 0.45 === 0.10000000000000003 in IEEE 754 —
			// without it the exact-boundary case the guard exists for
			// would slip through as "clear".
			if (stats.get(ranked[0]).share - stats.get(ranked[1]).share <= AMBIGUITY_SHARE_GAP + 1e-9) {
				start = 2;
			}
			for (let i = start; i < Math.min(ranked.length, people.length); i++) {
				assigned.set(ranked[i], people[i]);
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
	isAutoNameEnabled,
	participantsFromEvent,
	computeProposal,
	loadParticipants,
	persistMappings,
};
