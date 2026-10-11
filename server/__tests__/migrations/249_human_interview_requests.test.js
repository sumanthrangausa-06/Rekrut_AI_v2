/**
 * S-012 (#651): Human interview requests migration — static content validation.
 *
 * Migration 249 creates human_interview_requests:
 *   - One request per session (UNIQUE session_id)
 *   - status: pending → approved | declined
 *   - recruiter_id = session.triggered_by (notified on request)
 *
 * All DDL must be idempotent (IF NOT EXISTS).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'249_human_interview_requests.js',
);

describe('249_human_interview_requests migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('creates human_interview_requests with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS human_interview_requests/i);
	});

	test('has session_id with UNIQUE constraint (one request per session)', () => {
		expect(src).toMatch(/session_id/i);
		expect(src).toMatch(/UNIQUE/i);
	});

	test('status has CHECK constraint for pending/approved/declined', () => {
		expect(src).toMatch(/CHECK/i);
		expect(src).toMatch(/pending/);
		expect(src).toMatch(/approved/);
		expect(src).toMatch(/declined/);
	});

	test('tracks recruiter, decision, and timestamps', () => {
		expect(src).toMatch(/recruiter_id/i);
		expect(src).toMatch(/decided_at/i);
		expect(src).toMatch(/decided_by/i);
	});
});
