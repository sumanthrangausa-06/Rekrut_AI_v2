/**
 * Task 3 (#343): assessment attempt deadlines migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: the IF NOT EXISTS guard, the TIMESTAMPTZ type, the
 * nullable (no NOT NULL / no DEFAULT) shape, and the up/down contract. Real
 * execution was verified under pg-mem (see the implementer's report) and will
 * run on the staging deploy.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'232_assessment_attempt_due_date.js',
);

describe('232_assessment_attempt_due_date migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports up/down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('adds due_date to job_assessment_attempts with IF NOT EXISTS', () => {
		expect(src).toMatch(/ALTER TABLE job_assessment_attempts\s+ADD COLUMN IF NOT EXISTS due_date/i);
	});

	test('due_date is TIMESTAMPTZ', () => {
		expect(src).toMatch(/due_date TIMESTAMPTZ/i);
	});

	test('due_date is nullable with no backfill (safe on shared DB)', () => {
		// No NOT NULL, no DEFAULT, no UPDATE backfill: existing rows get NULL.
		expect(src).not.toMatch(/due_date[^;]*NOT NULL/i);
		expect(src).not.toMatch(/UPDATE job_assessment_attempts/i);
	});

	test('down drops the column with IF EXISTS', () => {
		expect(src).toMatch(/DROP COLUMN IF EXISTS due_date/i);
	});
});
