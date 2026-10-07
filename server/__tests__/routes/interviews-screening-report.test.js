/**
 * Bug fix: GET /screening/:id/report must read from the unified interview_sessions
 * table (type='screening'), not legacy screening_sessions.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left this
 * report endpoint on screening_sessions — returns 404 for all new sessions.
 *
 * The unified table stores:
 * - questions → config->'template'->'questions'
 * - ai_report → config->'report'
 * - overall_score → interview_evaluations via interview_session_id
 * - conversation → conversation JSONB column
 *
 * RED: test fails because the SQL queries screening_sessions.
 * GREEN: test passes after the query uses interview_sessions.
 */
describe('GET /screening/:id/report source table', () => {
	test('does NOT query screening_sessions table', () => {
		const fs = require('fs');
		const path = require('path');
		const source = fs.readFileSync(
			path.join(__dirname, '../../../routes/interviews.js'),
			'utf8',
		);

		// Find the report endpoint
		const match = source.match(
			/router\.get\('\/screening\/:id\/report'[\s\S]*?res\.json\(\{/,
		);
		expect(match).toBeTruthy();
		expect(match[0].toLowerCase()).not.toContain('screening_sessions');
		expect(match[0].toLowerCase()).toContain('interview_sessions');
	});
});
