/**
 * Bug fix: checkStalledScreenings must query the unified interview_sessions table
 * (type='screening'), not legacy screening_sessions.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left this
 * nudge query on screening_sessions — stalled invites never trigger nudges.
 *
 * RED: test fails because the SQL queries screening_sessions.
 * GREEN: test passes after the query uses interview_sessions.
 */
describe('checkStalledScreenings source table', () => {
	test('does NOT query screening_sessions table', () => {
		const fs = require('fs');
		const path = require('path');
		const source = fs.readFileSync(
			path.join(__dirname, '../../../services/interview-ai.js'),
			'utf8',
		);

		// Find the checkStalledScreenings function
		const match = source.match(
			/async function checkStalledScreenings[\s\S]*?return stalled\.rows\.length;/,
		);
		expect(match).toBeTruthy();
		expect(match[0].toLowerCase()).not.toContain('screening_sessions');
		expect(match[0].toLowerCase()).toContain('interview_sessions');
	});
});
