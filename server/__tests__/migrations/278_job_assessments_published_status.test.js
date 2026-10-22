/**
 * #1642 — migration 278: job_assessments 'published' CHECK widening.
 *
 * Static contract tests (275-style): guard the migration file itself —
 * house export shape, the exact widened value set, the find-by-definition
 * drop scoped so the sibling difficulty CHECK cannot match, and the hard
 * loudness requirement: NO exception swallow anywhere.
 *
 * The real-DB red/green proof (fresh migrate.js builds, publish UPDATE
 * failing pre-278 with chk_job_assessments_status violation and landing
 * post-278, read back from pg_constraint) is recorded on issue #1642 and
 * PR #1644; this file guards the migration's static contract.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'278_job_assessments_published_status.js',
);
const MIGRATION_NAME = '278_job_assessments_published_status';
const WIDENED_VALUES = ['draft', 'active', 'archived', 'published'];

describe('278_job_assessments_published_status migration (static contract)', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name and up function (migrate.js contract)', () => {
		expect(migration.name).toBe(MIGRATION_NAME);
		expect(typeof migration.up).toBe('function');
	});

	test('adds the canonical constraint with the exact widened value set', () => {
		expect(src).toMatch(/ADD CONSTRAINT chk_job_assessments_status\b/i);
		for (const v of WIDENED_VALUES) {
			expect(src).toContain(`'${v}'`);
		}
		expect(src).toMatch(
			/CHECK\s*\(\s*status IN \('draft',\s*'active',\s*'archived',\s*'published'\)\s*\)/i,
		);
	});

	test("does NOT add 'closed' (jobs vocabulary; no writer/reader for this table)", () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		// The up() body must not admit 'closed' as a status value.
		const upBody = code.slice(code.indexOf('up:'));
		expect(upBody).not.toContain("'closed'");
	});

	test('drops existing CHECKs by definition via pg_constraint (274/275 pattern), scoped to the status vocabulary', () => {
		expect(src).toMatch(/FROM pg_constraint/i);
		expect(src).toMatch(/conrelid = 'job_assessments'::regclass/i);
		expect(src).toMatch(/contype = 'c'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) ILIKE '%status%'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) ILIKE '%draft%'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) ILIKE '%archived%'/i);
		expect(src).toMatch(/DROP CONSTRAINT/i);
	});

	test('LOUD: no exception swallow anywhere — no EXCEPTION block, no try/catch', () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/EXCEPTION/i);
		expect(code).not.toMatch(/\btry\s*\{/);
		expect(code).not.toMatch(/\bcatch\b/);
	});

	test('expand-only: touches nothing else — no data writes, no column change, no table drop', () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/INSERT INTO|UPDATE job_assessments SET|DELETE FROM/i);
		expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i);
	});
});
