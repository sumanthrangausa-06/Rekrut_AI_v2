/**
 * S-003 (#642): Session lifecycle migration — static content validation.
 *
 * Migration 248 adds lifecycle columns to interview_sessions:
 *   - last_heartbeat_at (lazy pause evaluation, AC-1)
 *   - current_question_index (resume position, AC-2)
 *   - paused_at (UX timestamp)
 *
 * All DDL must be idempotent (ADD COLUMN IF NOT EXISTS).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'248_session_lifecycle.js',
);

describe('248_session_lifecycle migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('adds last_heartbeat_at with IF NOT EXISTS (AC-1 lazy pause)', () => {
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS last_heartbeat_at/i);
		expect(src).toMatch(/last_heartbeat_at TIMESTAMPTZ/i);
	});

	test('adds current_question_index with IF NOT EXISTS (AC-2 resume)', () => {
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS current_question_index/i);
	});

	test('adds paused_at with IF NOT EXISTS', () => {
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS paused_at/i);
	});

	test('all DDL is idempotent', () => {
		// Every ALTER TABLE ... ADD COLUMN must use IF NOT EXISTS
		const addColumns = src.match(/ADD COLUMN (?!IF NOT EXISTS)/gi) || [];
		expect(addColumns).toHaveLength(0);
	});

	test('targets interview_sessions table', () => {
		expect(src).toMatch(/ALTER TABLE interview_sessions/i);
	});
});
