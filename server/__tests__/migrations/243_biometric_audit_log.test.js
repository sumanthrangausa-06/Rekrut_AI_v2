/**
 * S-014 (#573): Biometric audit log migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: required table, columns, IF NOT EXISTS guards,
 * append-only trigger, and indexes.
 *
 * LIVE-DB VERIFICATION REQUIRED: The trigger `trg_biometric_audit_log_no_update`
 * must be verified against a real PostgreSQL instance (staging or local) before
 * this story is considered fully done. See sprint DoD.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'243_biometric_audit_log.js',
);

describe('243_biometric_audit_log migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('creates biometric_audit_log with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS biometric_audit_log/);
	});

	test('biometric_audit_log has every required column', () => {
		const required = [
			'id',
			'accessed_at',
			'user_id',
			'user_role',
			'action',
			'data_type',
			'candidate_id',
			'ip_address',
		];
		// Extract the CREATE TABLE statement (up to the first CREATE INDEX),
		// avoiding nested-paren issues with CHECK constraints.
		const tableStart = src.indexOf('CREATE TABLE IF NOT EXISTS biometric_audit_log');
		expect(tableStart).toBeGreaterThanOrEqual(0);
		const afterTable = src.slice(tableStart);
		const indexStart = afterTable.indexOf('CREATE INDEX');
		const tableStmt = indexStart > 0 ? afterTable.slice(0, indexStart) : afterTable;
		for (const col of required) {
			expect(tableStmt).toMatch(new RegExp(`\\b${col}\\b`));
		}
	});

	test('action has CHECK constraint for view/export/delete/purge', () => {
		expect(src).toMatch(/CHECK \(action IN \('view', 'export', 'delete', 'purge'\)\)/);
	});

	test('user_role has CHECK constraint', () => {
		expect(src).toMatch(/CHECK \(user_role IN/);
	});

	test('defines prevent_audit_mutation trigger function', () => {
		expect(src).toMatch(/CREATE OR REPLACE FUNCTION prevent_audit_mutation\(\)/);
		expect(src).toMatch(/RETURNS trigger/);
	});

	test('trigger function raises exception (blocks mutation)', () => {
		expect(src).toMatch(/RAISE EXCEPTION/);
		expect(src).toMatch(/append-only/);
	});

	test('creates BEFORE UPDATE OR DELETE trigger on the table', () => {
		expect(src).toMatch(/CREATE TRIGGER trg_biometric_audit_log_no_update/);
		expect(src).toMatch(/BEFORE UPDATE OR DELETE ON biometric_audit_log/);
		expect(src).toMatch(/EXECUTE FUNCTION prevent_audit_mutation\(\)/);
	});

	test('drops trigger if exists before creating (idempotent)', () => {
		expect(src).toMatch(/DROP TRIGGER IF EXISTS trg_biometric_audit_log_no_update/);
	});

	test('creates indexes on accessed_at and user_id', () => {
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_audit_time/);
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_audit_user/);
	});

	test('revokes TRUNCATE from app role (bypasses row triggers)', () => {
		expect(src).toMatch(/REVOKE TRUNCATE ON biometric_audit_log/);
	});

	test('documents 7-year retention policy', () => {
		expect(src).toMatch(/7 years|7-year/i);
	});
});
