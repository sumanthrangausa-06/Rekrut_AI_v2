/**
 * Task 7 (#322): interview_flows generalization migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: required table, columns, IF NOT EXISTS guards,
 * and the screening_templates backfill. Real execution happens under pg-mem
 * (see the implementer's report) and on the staging deploy.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'132_interview_flows.js',
);

describe('132_interview_flows migration', () => {
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

	test('creates interview_flows with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS interview_flows/);
	});

	test('interview_flows has every required column', () => {
		const required = [
			'id',
			'company_id',
			'job_id',
			'created_by',
			'name',
			'type',
			'description',
			'phases',
			'topics',
			'questions',
			'rubric_weights',
			'triggers',
			'status',
			'created_at',
			'updated_at',
		];
		// Block-scoped match so column names can't leak from other statements.
		const block = src.match(/CREATE TABLE IF NOT EXISTS interview_flows \(([\s\S]*?)\n\s*\)/);
		expect(block).not.toBeNull();
		for (const col of required) {
			expect(block[1]).toMatch(new RegExp(`\\b${col}\\b`));
		}
	});

	test('phases/topics/questions/rubric_weights/triggers are JSONB', () => {
		expect(src).toMatch(/phases JSONB/);
		expect(src).toMatch(/topics JSONB/);
		expect(src).toMatch(/questions JSONB/);
		expect(src).toMatch(/rubric_weights JSONB/);
		expect(src).toMatch(/triggers JSONB/);
	});

	test('every CREATE TABLE uses IF NOT EXISTS', () => {
		const bare = src.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/g);
		expect(bare).toBeNull();
	});

	test('up binds only client (no pool reference)', () => {
		expect(src).not.toMatch(/\bpool\./);
	});

	test('backfills active templates from screening_templates', () => {
		expect(src).toMatch(/INSERT INTO interview_flows/);
		expect(src).toMatch(/FROM screening_templates/);
		expect(src).toMatch(/status = 'active'/);
	});

	test('backfill is order-safe against the p6 topics migration', () => {
		// 132 sorts before p6_*.js, so it must ensure the topics column itself.
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS topics/);
	});

	test('creates lookup indexes', () => {
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_interview_flows_job/);
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_interview_flows_company/);
	});
});
