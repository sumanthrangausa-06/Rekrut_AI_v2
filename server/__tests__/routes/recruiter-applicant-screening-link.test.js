/**
 * Bug fix: applicant list screening_session_id must come from the unified
 * interview_sessions table (type='screening'), not legacy screening_sessions.
 *
 * Phase 1 (#322) migrated screening WRITES to interview_sessions but left this
 * subquery on screening_sessions — always NULL for new sessions.
 *
 * RED: test fails because the SQL queries screening_sessions.
 * GREEN: test passes after the subquery uses interview_sessions.
 */
const db = require('../../../lib/db');

// Capture all SQL executed by the recruiter routes module
const executedSQL = [];

db.query.mockImplementation(async (sql, params = []) => {
	executedSQL.push(sql);
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	// Return empty for the main query — we only care about what tables are hit
	if (normalized.includes('from job_applications')) {
		return { rows: [], rowCount: 0 };
	}
	throw new Error(`unexpected SQL: ${sql}`);
});

require('../../../routes/recruiter');

describe('applicant list screening_session_id source table', () => {
	beforeEach(() => {
		executedSQL.length = 0;
	});

	test('does NOT query screening_sessions table', () => {
		// The recruiter routes module is loaded at require time; the SQL is
		// embedded in the route handler. We verify by inspecting the module
		// source — the route handler must not reference the legacy table.
		const fs = require('fs');
		const path = require('path');
		const source = fs.readFileSync(
			path.join(__dirname, '../../../routes/recruiter.js'),
			'utf8',
		);

		// Find the applicant list query containing screening_session_id
		const match = source.match(
			/\(SELECT[\s\S]*?as screening_session_id/,
		);
		expect(match).toBeTruthy();
		expect(match[0].toLowerCase()).not.toContain('screening_sessions');
		expect(match[0].toLowerCase()).toContain('interview_sessions');
	});
});
