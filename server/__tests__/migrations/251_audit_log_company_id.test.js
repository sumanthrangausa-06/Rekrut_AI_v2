/**
 * S-065 C1 (#715): tenant isolation for biometric_audit_log.
 *
 * Migration 251 adds a nullable company_id column + composite index so the
 * read path can scope hiring_manager queries to their own company.
 * Static contract validation (same pattern as 250).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'251_audit_log_company_id.js',
);

describe('251_audit_log_company_id migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports up and down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('adds nullable company_id column to biometric_audit_log', () => {
		expect(src).toMatch(/ALTER TABLE biometric_audit_log/);
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS company_id INTEGER/);
	});

	test('creates composite index on (company_id, accessed_at)', () => {
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS/);
		expect(src).toMatch(/idx_biometric_audit_log_company_accessed/);
		expect(src).toMatch(/\(company_id, accessed_at/);
	});

	test('DDL is idempotent (IF NOT EXISTS guards)', () => {
		expect(src).toMatch(/IF NOT EXISTS company_id/);
		expect(src).toMatch(/IF NOT EXISTS idx_biometric_audit_log_company_accessed/);
	});

	test('down reverses cleanly (drops index, then column)', () => {
		expect(src).toMatch(/DROP INDEX IF EXISTS idx_biometric_audit_log_company_accessed/);
		expect(src).toMatch(/DROP COLUMN IF EXISTS company_id/);
	});
});
