/**
 * #2041 — POST /gdpr/export: explicit projections for the eight
 * remaining verbatim sections.
 *
 * The users section got its explicit allowlist in #2035 and the
 * biometric tables in #2033; the other export sections still read
 * `SELECT *` and ship rows verbatim, so any column added to one of
 * those tables later would be exported by default, with no gate.
 * This pin reads the handler source and asserts, per table:
 *   (a) no `SELECT * FROM <table>` remains in the POST /gdpr/export
 *       handler for that table's export query,
 *   (b) the table's EXPORT_*_COLUMNS constant names exactly the
 *       intended column set — the table's live columns verified
 *       against information_schema on a fresh migrated DB (PG 18.6,
 *       gate rig, this run) — no more, no fewer,
 *   (c) the export query is built from that constant.
 *
 * No exclusions: every live column is the subject's own data in
 * DSAR scope; shrinking the subject's copy is a Lex ruling, not a
 * hardening lane (STOP 1 on #2041; #2033 precedent). Behaviour —
 * the bundle is field-for-field identical today, and a future
 * column does NOT leak — is covered by the #2041 real-DB journey.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../../routes/compliance.js'), 'utf8');

const TABLES = {
	omni_scores: {
		constant: 'EXPORT_OMNI_SCORE_COLUMNS',
		columns: [
			'id', 'user_id', 'total_score', 'interview_score', 'technical_score',
			'resume_score', 'behavior_score', 'score_tier', 'last_updated',
			'created_at', 'factor_scores', 'peer_percentile', 'last_checkin_at',
			'fraud_signals', 'version',
		],
	},
	score_history: {
		constant: 'EXPORT_SCORE_HISTORY_COLUMNS',
		columns: [
			'id', 'user_id', 'previous_score', 'new_score', 'change_amount',
			'change_reason', 'component_type', 'created_at', 'score_snapshot',
		],
	},
	score_snapshots: {
		constant: 'EXPORT_SCORE_SNAPSHOT_COLUMNS',
		columns: [
			'id', 'user_id', 'total_score', 'factor_scores', 'peer_percentile',
			'snapshot_week', 'created_at',
		],
	},
	interviews: {
		constant: 'EXPORT_INTERVIEW_COLUMNS',
		columns: [
			'id', 'user_id', 'job_id', 'interview_type', 'status', 'questions',
			'responses', 'ai_feedback', 'overall_score', 'duration_seconds',
			'video_urls', 'created_at', 'completed_at', 'updated_at',
		],
	},
	assessment_results: {
		constant: 'EXPORT_ASSESSMENT_COLUMNS',
		columns: ['id', 'user_id', 'skill_name', 'score', 'created_at'],
	},
	candidate_profiles: {
		constant: 'EXPORT_PROFILE_COLUMNS',
		columns: [
			'id', 'user_id', 'headline', 'summary', 'skills', 'experience',
			'education', 'resume_url', 'linkedin_url', 'portfolio_url',
			'location', 'preferred_role', 'salary_expectation',
			'remote_preference', 'bio', 'phone', 'github_url', 'photo_url',
			'salary_min', 'salary_max', 'preferred_job_types',
			'preferred_locations', 'years_experience', 'created_at',
			'updated_at', 'availability', 'work_authorization',
			'certifications', 'preferred_industries',
			'visa_sponsorship_needed', 'notice_period', 'willing_to_relocate',
			'preferred_company_size', 'cover_letter_template',
			'timezone_preference', 'travel_willingness', 'salary_currency',
			'work_mode', 'work_hours', 'start_date_flexibility',
			'salary_expectation_min', 'salary_expectation_max',
		],
	},
	consent_records: {
		constant: 'EXPORT_CONSENT_COLUMNS',
		columns: [
			'id', 'user_id', 'consent_type', 'consented', 'consented_at',
			'ip_address', 'metadata', 'created_at', 'updated_at', 'revoked_at',
			'revoked_by', 'revocation_reason',
		],
	},
	audit_logs: {
		constant: 'EXPORT_AUDIT_LOG_COLUMNS',
		columns: [
			'id', 'action_type', 'user_id', 'target_type', 'target_id',
			'metadata', 'ip_address', 'user_agent', 'created_at', 'company_id',
			'actor_id', 'action', 'reason',
		],
	},
};

function constantColumns(name) {
	const re = new RegExp(`const ${name} =\\s*'([^']+)'`);
	const m = SRC.match(re);
	return m ? m[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) : null;
}

// The lane's scope is the POST /gdpr/export handler only: slice its
// source region so a same-table query in another endpoint (e.g. the
// consent-history read) is neither pinned nor condemned by this suite.
const HANDLER_START = SRC.indexOf("router.post('/gdpr/export'");
const HANDLER_END = SRC.indexOf('// Right to be forgotten', HANDLER_START);
const HANDLER = SRC.slice(HANDLER_START, HANDLER_END);

describe('#2041 GDPR export explicit projections (pin)', () => {
	test('export handler region found', () => {
		expect(HANDLER_START).toBeGreaterThan(-1);
		expect(HANDLER_END).toBeGreaterThan(HANDLER_START);
	});
	for (const [table, { constant, columns }] of Object.entries(TABLES)) {
		test(`${table}: no SELECT * in the export handler, constant names exactly the intended columns, query uses the constant`, () => {
			expect(HANDLER).not.toMatch(new RegExp(`SELECT\\s+\\*\\s+FROM\\s+${table}\\b`, 'i'));
			const named = constantColumns(constant);
			expect(named).not.toBeNull();
			expect([...named].sort()).toEqual([...columns].sort());
			expect(HANDLER).toContain(`SELECT \${${constant}} FROM ${table}`);
		});
	}
});
