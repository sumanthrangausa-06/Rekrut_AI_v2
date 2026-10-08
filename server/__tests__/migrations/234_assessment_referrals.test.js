/**
 * Issue #349, task 1: assessment_referrals migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: the IF NOT EXISTS guards and the table shape.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'234_assessment_referrals.js',
);

describe('234_assessment_referrals migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('creates assessment_referrals with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS assessment_referrals/i);
	});

	test('has token_hash UNIQUE for sha256 lookup', () => {
		expect(src).toMatch(/token_hash VARCHAR\(64\)[^,]*UNIQUE/i);
	});

	test('references job_assessments with cascade delete', () => {
		expect(src).toMatch(/job_assessment_id INTEGER NOT NULL REFERENCES job_assessments\(id\) ON DELETE CASCADE/i);
	});

	test('has email and due_date columns', () => {
		expect(src).toMatch(/email VARCHAR\(255\) NOT NULL/i);
		expect(src).toMatch(/due_date TIMESTAMPTZ/i);
	});

	test('tracks claim state (nullable, no backfill)', () => {
		expect(src).toMatch(/claimed_by_user_id INTEGER REFERENCES users\(id\) ON DELETE SET NULL/i);
		expect(src).toMatch(/claimed_at TIMESTAMPTZ/i);
		expect(src).not.toMatch(/UPDATE assessment_referrals/i);
	});

	test('creates indexes on token_hash and email', () => {
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_assessment_referrals_token/i);
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_assessment_referrals_email/i);
	});
});
