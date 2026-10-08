/**
 * Task 4 (#343): assessment score round-trip migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: the IF NOT EXISTS guards, the nullable (no NOT NULL
 * / no DEFAULT / no backfill) shape, and the up/down contract.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'233_assessment_score_roundtrip.js',
);

describe('233_assessment_score_roundtrip migration', () => {
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

	test('adds assessment_score to job_applications with IF NOT EXISTS', () => {
		expect(src).toMatch(
			/ALTER TABLE job_applications\s+ADD COLUMN IF NOT EXISTS assessment_score/i,
		);
	});

	test('adds assessment_result to job_applications with IF NOT EXISTS', () => {
		expect(src).toMatch(
			/ALTER TABLE job_applications\s+ADD COLUMN IF NOT EXISTS assessment_result/i,
		);
	});

	test('both columns are nullable with no backfill (safe on shared DB)', () => {
		expect(src).not.toMatch(/assessment_score[^;]*NOT NULL/i);
		expect(src).not.toMatch(/assessment_result[^;]*NOT NULL/i);
		expect(src).not.toMatch(/UPDATE job_applications/i);
	});

	test('down drops both columns with IF EXISTS', () => {
		expect(src).toMatch(/DROP COLUMN IF EXISTS assessment_result/i);
		expect(src).toMatch(/DROP COLUMN IF EXISTS assessment_score/i);
	});
});
