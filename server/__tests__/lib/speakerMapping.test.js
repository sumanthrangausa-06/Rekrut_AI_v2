/**
 * speakerMapping.test.js — S-D08 (#1910), pure proposal logic.
 *
 * User-perspective framing: a recruiter opening a transcript expects
 * speaker numbers already proposed as the people who were in the call
 * WHERE THE FACTS SUPPORT IT — and honestly unassigned ("Speaker N")
 * where they don't. The proposal never guesses (FR-D09), never looks
 * at transcript content (meeting facts only, BR-12), and never
 * persists the speaking-share figures it used to decide (AC-6).
 *
 * AC map: AC-1 clear leader → candidate/lead · AC-2 top-two within
 * 10 percentage points → both unassigned · AC-3 more speakers →
 * extras unassigned, fewer → silent participants get no speaker ·
 * AC-4 no participants → all unassigned · AC-5 DIARIZATION_AUTO_NAME
 * off → proposal skipped entirely · AC-6 no share/turn-count/
 * confidence anywhere in the proposal output · §3.7 rule 1: a single
 * voice in a multi-participant call is NOT assumed to be the
 * candidate.
 */

const {
	computeProposal,
	participantsFromEvent,
	isAutoNameEnabled,
	AMBIGUITY_SHARE_GAP,
} = require('../../../lib/speakerMapping');

const turn = (speaker, start_s, end_s) => ({ speaker, start_s, end_s });
const CAND = { userId: 11, role: 'candidate' };
const LEAD = { userId: 22, role: 'interviewer' };
const PANEL = { userId: 33, role: 'interviewer' };

const bySpeaker = (rows) => Object.fromEntries(rows.map((r) => [r.speaker_number, r]));

describe('speakerMapping.computeProposal (S-D08)', () => {
	it('AC-1: clear share leader → candidate, next → lead interviewer, state data carries no figures', () => {
		// speaker 1 speaks 60s, speaker 0 speaks 40s (60/40 — clear leader)
		const turns = [turn(0, 0, 40), turn(1, 40, 100)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD] });
		const m = bySpeaker(rows);
		expect(m[1]).toEqual({ speaker_number: 1, participant_user_id: 11, participant_role: 'candidate' });
		expect(m[0]).toEqual({ speaker_number: 0, participant_user_id: 22, participant_role: 'interviewer' });
		expect(proposedMapping).toEqual({
			'0': { participant_user_id: 22, participant_role: 'interviewer' },
			'1': { participant_user_id: 11, participant_role: 'candidate' },
		});
	});

	it('AC-2: top-two shares within 10 points → BOTH stay unassigned, never a guessed swap', () => {
		const turns = [turn(0, 0, 52), turn(1, 52, 100)]; // 52 / 48
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows).toHaveLength(2);
		for (const r of rows) {
			expect(r.participant_user_id).toBeNull();
			expect(r.participant_role).toBeNull();
		}
		expect(proposedMapping).toEqual({ '0': null, '1': null });
	});

	it('AC-2 boundary: exactly a 10-point gap is still ambiguous; 12 points is clear', () => {
		expect(AMBIGUITY_SHARE_GAP).toBe(0.1);
		const at = computeProposal({ turns: [turn(0, 0, 55), turn(1, 55, 100)], participants: [CAND, LEAD] });
		expect(at.rows.every((r) => r.participant_user_id === null)).toBe(true);
		const clear = computeProposal({ turns: [turn(0, 0, 56), turn(1, 56, 100)], participants: [CAND, LEAD] });
		expect(bySpeaker(clear.rows)[0].participant_user_id).toBe(11);
	});

	it('AC-2 with a panel: guard trip voids ALL assignments (reconciled reading, PR #1932 review B-2)', () => {
		// shares 40 / 38 / 22 — the top is ambiguous, so every pairing
		// below it rests on the same untrustworthy ranking: nobody is
		// proposed. (Supersedes the original "third still pairs" —
		// Suga ruling on the B-2 STOP 1 conflict, #1910.)
		const turns = [turn(0, 0, 40), turn(1, 40, 78), turn(2, 78, 100)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		expect(rows).toHaveLength(3);
		for (const r of rows) expect(r.participant_user_id).toBeNull();
	});

	it('B-1: a sub-100ms phantom speaker gains NO row and NO name (assignable-turn floor)', () => {
		// speaker 2 speaks 60ms — engine noise (#1929 M4), not a voice.
		const turns = [turn(0, 0, 60), turn(1, 60, 100), turn(2, 100, 100.06)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 1]);
		expect(bySpeaker(rows)[0].participant_user_id).toBe(11);
		expect(bySpeaker(rows)[1].participant_user_id).toBe(22);
		expect(proposedMapping['2']).toBeUndefined();
	});

	it('N-1 (PR #1935 re-review): an exactly-100ms turn at a non-zero offset IS assignable (ms arithmetic)', () => {
		// 0.2 → 0.3 is exactly 100ms, but 0.09999999999999998 in float
		// seconds; stitch (ms integers) treats it as assignable, so
		// the mapping speaker set must too.
		const turns = [turn(0, 0.2, 0.3), turn(1, 0.3, 5.3)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 1]);
	});

	it('B-2 probe: all-zero-duration turns → no assignable speakers, no name proposed on zero evidence', () => {
		const turns = [turn(0, 5, 5), turn(1, 9, 9), turn(2, 12, 12)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		expect(rows).toEqual([]);
	});

	it('M-1: tie-break is chronological first-speaking (min start_s), not array order', () => {
		// Array lists speaker 1 first, but speaker 2 speaks earlier;
		// shares 50 / 25 / 25 — the tied pair must rank by who spoke
		// first for the lead-interviewer slot.
		const turns = [turn(1, 75, 100), turn(0, 0, 50), turn(2, 50, 75)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		const m = bySpeaker(rows);
		expect(m[0].participant_user_id).toBe(11);
		expect(m[2].participant_user_id).toBe(22); // spoke at 50s — ranks ahead of speaker 1 (75s)
		expect(m[1].participant_user_id).toBeNull(); // panel slot: never auto-proposed (privacy (c) cap)
	});

	it('privacy (c) cap: panel members are never auto-proposed, even with an exact speaker/participant count', () => {
		// §3.7 rule 2's assign-in-order would pair speaker 2 → panel;
		// no meeting fact distinguishes panel members, so the cap
		// leaves the panel speaker unassigned for manual mapping.
		const turns = [turn(0, 0, 60), turn(1, 60, 90), turn(2, 90, 100)]; // 60 / 30 / 10, clear top
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		const m = bySpeaker(rows);
		expect(m[0].participant_user_id).toBe(11);
		expect(m[1].participant_user_id).toBe(22);
		expect(m[2].participant_user_id).toBeNull();
		expect(m[2].participant_role).toBeNull();
	});

	it('M-2: zero turns with auto-name OFF → proposedMapping is null (skipped signal preserved)', () => {
		const { rows, proposedMapping } = computeProposal({ turns: [], participants: [CAND, LEAD], autoNameEnabled: false });
		expect(rows).toEqual([]);
		expect(proposedMapping).toBeNull();
	});

	it('AC-3: more speakers than participants → extra speakers persist unassigned', () => {
		const turns = [turn(0, 0, 50), turn(1, 50, 80), turn(2, 80, 100)]; // 50/30/20
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD] });
		const m = bySpeaker(rows);
		expect(rows).toHaveLength(3); // one row per speaker, including the unassigned extra
		expect(m[0].participant_user_id).toBe(11);
		expect(m[1].participant_user_id).toBe(22);
		expect(m[2].participant_user_id).toBeNull();
	});

	it('AC-3: fewer speakers than participants → silent participants get no speaker, no row invented for them', () => {
		const turns = [turn(0, 0, 70), turn(1, 70, 100)]; // 70/30
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD, PANEL] });
		expect(rows).toHaveLength(2); // speakers only — the silent panel member has no row
		expect(bySpeaker(rows)[0].participant_user_id).toBe(11);
		expect(bySpeaker(rows)[1].participant_user_id).toBe(22);
	});

	it('AC-4: no resolvable participants → every speaker unassigned', () => {
		const turns = [turn(0, 0, 60), turn(1, 60, 100)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [] });
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.participant_user_id === null && r.participant_role === null)).toBe(true);
		expect(proposedMapping).toEqual({ '0': null, '1': null });
	});

	it('AC-5: auto-name OFF → proposal skipped entirely (all unassigned, no proposed_mapping), even with a clear leader', () => {
		const turns = [turn(0, 0, 40), turn(1, 40, 100)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD], autoNameEnabled: false });
		expect(rows).toHaveLength(2); // rows still persist so "Speaker N" + manual mapping work
		expect(rows.every((r) => r.participant_user_id === null)).toBe(true);
		expect(proposedMapping).toBeNull(); // skipped entirely — no proposal was generated
	});

	it('§3.7 rule 1: a single voice in a multi-participant call is NOT assumed to be the candidate', () => {
		const { rows } = computeProposal({ turns: [turn(0, 0, 100)], participants: [CAND, LEAD] });
		expect(rows).toEqual([{ speaker_number: 0, participant_user_id: null, participant_role: null }]);
	});

	it('§3.7 rule 1: a single voice with exactly one participant IS assigned to that participant', () => {
		const { rows } = computeProposal({ turns: [turn(3, 0, 100)], participants: [CAND] });
		expect(rows).toEqual([{ speaker_number: 3, participant_user_id: 11, participant_role: 'candidate' }]);
	});

	it('AC-6: no share / turn-count / confidence figure exists anywhere in the proposal output', () => {
		const turns = [turn(0, 0, 40), turn(1, 40, 100)];
		const out = computeProposal({ turns, participants: [CAND, LEAD] });
		const json = JSON.stringify(out);
		for (const banned of ['share', 'count', 'confidence', 'duration', 'order']) {
			expect(json.toLowerCase()).not.toContain(banned);
		}
		for (const r of out.rows) {
			expect(Object.keys(r).sort()).toEqual(['participant_role', 'participant_user_id', 'speaker_number']);
		}
	});

	it('speakers are the distinct turn speakers, rows sorted by speaker number', () => {
		const turns = [turn(2, 0, 10), turn(0, 10, 20), turn(2, 20, 90), turn(1, 90, 100)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 1, 2]);
	});

	it('no turns → no rows, empty proposal object', () => {
		const { rows, proposedMapping } = computeProposal({ turns: [], participants: [CAND, LEAD] });
		expect(rows).toEqual([]);
		expect(proposedMapping).toEqual({});
	});
});

describe('speakerMapping.participantsFromEvent (OQ-4 source)', () => {
	it('orders candidate → lead recruiter → panel, roles snapshotted, duplicates removed', () => {
		const event = { candidate_id: 11, recruiter_id: 22, panel_member_ids: [33, 22, 44] };
		expect(participantsFromEvent(event)).toEqual([
			{ userId: 11, role: 'candidate' },
			{ userId: 22, role: 'interviewer' },
			{ userId: 33, role: 'interviewer' },
			{ userId: 44, role: 'interviewer' },
		]);
	});

	it('missing event / all-null ids → empty list (FR-D10 manual path)', () => {
		expect(participantsFromEvent(null)).toEqual([]);
		expect(participantsFromEvent({ candidate_id: null, recruiter_id: null, panel_member_ids: null })).toEqual([]);
	});
});

describe('speakerMapping.computeProposal — speaker-number range contract (#1934 M-3)', () => {
	it('a negative speaker number produces NO row and NO proposedMapping entry', () => {
		const turns = [turn(-1, 0, 60), turn(0, 60, 90), turn(1, 90, 100)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 1]);
		expect(proposedMapping['-1']).toBeUndefined();
	});

	it('a negative speaker with the largest share cannot steal a participant assignment', () => {
		// On base, speaker -1 (60s) is proposed as the candidate.
		// After the guard only speaker 0 remains — a single voice in a
		// multi-participant call, which rule 1 leaves unassigned.
		const turns = [turn(-1, 0, 60), turn(0, 60, 100)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows).toEqual([{ speaker_number: 0, participant_user_id: null, participant_role: null }]);
	});

	it('speakers above the int4 max produce NO row (they would fail the mapping INSERT and roll back the stitch)', () => {
		for (const bad of [2147483648, 3000000000]) {
			const turns = [turn(bad, 0, 60), turn(0, 60, 100)];
			const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD] });
			expect(rows.map((r) => r.speaker_number)).toEqual([0]);
			expect(proposedMapping[String(bad)]).toBeUndefined();
		}
	});

	it('boundary speakers 0 and int4-max (2147483647) DO produce rows', () => {
		const turns = [turn(0, 0, 60), turn(2147483647, 60, 100)];
		const { rows } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 2147483647]);
	});

	it('a float speaker number produces NO row (integer-only contract, stated explicitly)', () => {
		const turns = [turn(1.5, 0, 60), turn(0, 60, 100)];
		const { rows, proposedMapping } = computeProposal({ turns, participants: [CAND, LEAD] });
		expect(rows.map((r) => r.speaker_number)).toEqual([0]);
		expect(proposedMapping['1.5']).toBeUndefined();
	});
});

describe('speakerMapping.isAutoNameEnabled (DIARIZATION_AUTO_NAME, HA-2 switch)', () => {
	it('defaults ON when unset, ON for anything except exactly \'false\'', () => {
		expect(isAutoNameEnabled({})).toBe(true);
		expect(isAutoNameEnabled({ DIARIZATION_AUTO_NAME: 'true' })).toBe(true);
		expect(isAutoNameEnabled({ DIARIZATION_AUTO_NAME: 'false' })).toBe(false);
	});

	it('reads the env fresh on every call — a flip takes effect immediately', () => {
		const env = {};
		expect(isAutoNameEnabled(env)).toBe(true);
		env.DIARIZATION_AUTO_NAME = 'false';
		expect(isAutoNameEnabled(env)).toBe(false);
	});

	it('#1934 M-4: plausible OFF spellings disable — the HA-2 switch fails toward OFF, not ON', () => {
		// A kill switch an operator flips during an HA-2 incident must
		// land OFF even with wrong casing, padding, or a numeric form.
		for (const v of ['FALSE', 'False', '0', 'off', 'OFF', 'no', ' false ', ' 0 ']) {
			expect(isAutoNameEnabled({ DIARIZATION_AUTO_NAME: v })).toBe(false);
		}
	});

	it('#1934 M-4: unset, true, and unrecognised values keep the documented default ON', () => {
		for (const v of ['true', 'TRUE', '1', 'yes', 'flase', 'disabled', '']) {
			expect(isAutoNameEnabled({ DIARIZATION_AUTO_NAME: v })).toBe(true);
		}
	});
});

