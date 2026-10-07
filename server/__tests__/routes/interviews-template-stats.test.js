/**
 * Bug fix: template stats (sessions_count, completed_count) must count from the
 * unified interview_sessions table (type='screening'), not legacy screening_sessions.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left these
 * counts on screening_sessions — always 0 for new sessions.
 *
 * RED: test fails because the SQL queries screening_sessions.
 * GREEN: test passes after the counts use interview_sessions.
 */
describe('template stats sessions_count source table', () => {
	test('does NOT query screening_sessions table for counts', () => {
		const fs = require('fs');
		const path = require('path');
		const source = fs.readFileSync(
			path.join(__dirname, '../../../routes/interviews.js'),
			'utf8',
		);

		// Find the template stats query with sessions_count
		const match = source.match(/\(SELECT COUNT\(\*\)[\s\S]*?as sessions_count/);
		expect(match).toBeTruthy();
		expect(match[0].toLowerCase()).not.toContain('screening_sessions');
		expect(match[0].toLowerCase()).toContain('interview_sessions');
	});

	test('does NOT query screening_sessions table for completed_count', () => {
		const fs = require('fs');
		const path = require('path');
		const source = fs.readFileSync(
			path.join(__dirname, '../../../routes/interviews.js'),
			'utf8',
		);

		const match = source.match(/\(SELECT COUNT\(\*\)[\s\S]*?as completed_count/);
		expect(match).toBeTruthy();
		expect(match[0].toLowerCase()).not.toContain('screening_sessions');
		expect(match[0].toLowerCase()).toContain('interview_sessions');
	});
});
