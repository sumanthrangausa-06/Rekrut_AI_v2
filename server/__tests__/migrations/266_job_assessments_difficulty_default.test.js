/**
 * Issue #1164: job_assessments.difficulty_level default 'auto' violates its
 * own CHECK — static content validation, following the 234 pattern.
 *
 * The real-DB red/green proof (default-reliant INSERT fails before, succeeds
 * after, storing 'medium') was run by Nova on a local scratch Postgres and
 * is recorded on issue #1164 / the PR; this test guards the migration file
 * itself against regression (e.g. widening the CHECK instead of fixing the
 * default, or changing the chosen value away from the writer's fallback).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'266_job_assessments_difficulty_default.js',
);

describe('266_job_assessments_difficulty_default migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name and up function (migrate.js contract)', () => {
		expect(migration.name).toBe('266_job_assessments_difficulty_default');
		expect(typeof migration.up).toBe('function');
	});

	test("sets the default to the CHECK-valid writer fallback 'medium'", () => {
		expect(src).toMatch(
			/ALTER TABLE job_assessments ALTER COLUMN difficulty_level SET DEFAULT 'medium'/i,
		);
	});

	test("does not widen the CHECK to legitimise 'auto'", () => {
		expect(src).not.toMatch(/ADD CONSTRAINT/i);
		expect(src).not.toMatch(/CHECK\s*\([^)]*'auto'/i);
		expect(src).not.toMatch(/SET DEFAULT 'auto'/i);
	});

	test('touches nothing else: no data rewrite, no drop, no type change', () => {
		expect(src).not.toMatch(/UPDATE job_assessments/i);
		expect(src).not.toMatch(/DROP/i);
		expect(src).not.toMatch(/ALTER COLUMN difficulty_level TYPE/i);
	});
});
