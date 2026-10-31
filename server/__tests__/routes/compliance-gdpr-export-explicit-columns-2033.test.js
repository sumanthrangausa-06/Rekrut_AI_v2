/**
 * #2033 — POST /gdpr/export biometric section: explicit column lists.
 *
 * The four queries below used `SELECT *`. That is safe today and unsafe
 * forever: any column added to one of these tables later would be
 * exported by default. This pin reads the handler source and asserts
 * (a) none of the four queries uses `SELECT *`, and (b) each query's
 * SELECT clause names exactly the intended column set, verified against
 * the migrations that create the tables:
 *   - recording_speaker_mappings / transcript_speaker_audit — mig 296
 *   - event_labelling_consent — mig 299 (subject's own ip_address /
 *     user_agent_hash stay: DSAR scope, recorded at STOP 1 on #2033)
 *   - observer_capture_outcomes — mig 257
 *
 * Behaviour (the exported bundle is byte-for-byte the same shape) is
 * covered by the 2028/2034 unit suites and the 2034 real-DB journey,
 * which run unchanged against the explicit lists.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../../routes/compliance.js'), 'utf8');

const TABLES = {
	recording_speaker_mappings: [
		'id', 'recording_id', 'speaker_number', 'participant_user_id',
		'participant_role', 'state', 'updated_by', 'created_at', 'updated_at',
	],
	transcript_speaker_audit: [
		'id', 'recording_id', 'speaker_number', 'from_user_id', 'to_user_id',
		'actor_user_id', 'action', 'created_at',
	],
	event_labelling_consent: [
		'id', 'interview_event_id', 'user_id', 'decision', 'notice_version',
		'decided_at', 'ip_address', 'user_agent_hash', 'created_at',
	],
	observer_capture_outcomes: [
		'interview_session_id', 'candidate_id', 'scope', 'is_test',
		'cohort_allowlist_version', 'chunks_persisted', 'chunks_dropped',
		'audio_seconds_captured', 'capture_gap_ratio', 'stop_reason',
		'started_at', 'stopped_at',
	],
};

function selectClauseFor(table) {
	// The clause may not cross a string-literal boundary (quote/backtick),
	// so the match is the SELECT inside the same literal as the FROM.
	const re = new RegExp(`SELECT\\s+([^'"\`]*?)\\s+FROM\\s+${table}\\b`, 'i');
	const m = SRC.match(re);
	return m ? m[1] : null;
}

describe('#2033 GDPR export explicit column lists', () => {
	for (const [table, columns] of Object.entries(TABLES)) {
		test(`${table}: query exists, uses no SELECT *, names every intended column and no other`, () => {
			const clause = selectClauseFor(table);
			expect(clause).not.toBeNull();
			expect(clause.trim()).not.toBe('*');
			expect(clause).not.toMatch(/\*/);
			const named = clause.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
			expect(named.sort()).toEqual([...columns].sort());
		});
	}
});
