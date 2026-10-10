/**
 * S-058 (#582): Biometric/PII segregation migration — static content validation.
 *
 * AC-1: biometric templates in separate tables from users, different encryption key.
 * AC-2: no FK from biometric tables to users/candidates — JOIN to name/email fails
 *        at schema level; linkage only via biometric_session_map.
 * AC-3: per-candidate random DEKs (candidate_data_keys), enabling crypto-shredding.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'246_biometric_segregation.js',
);

describe('246_biometric_segregation migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('AC-3: creates candidate_data_keys table for per-candidate DEKs', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS candidate_data_keys/);
		expect(src).toMatch(/candidate_id INTEGER PRIMARY KEY/);
		expect(src).toMatch(/dek_encrypted BYTEA NOT NULL/);
		expect(src).toMatch(/destroyed_at TIMESTAMPTZ/);
	});

	test('AC-1: creates biometric_templates table separate from users', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS biometric_templates/);
		expect(src).toMatch(/template_encrypted BYTEA NOT NULL/);
		expect(src).toMatch(/subject_ref/);
	});

	test('AC-2: biometric_templates has NO foreign key to users or candidates', () => {
		// Extract the biometric_templates CREATE TABLE block and assert no REFERENCES
		const tableBlock = src.match(
			/CREATE TABLE IF NOT EXISTS biometric_templates \(([\s\S]*?)\n\s*\)/,
		);
		expect(tableBlock).not.toBeNull();
		expect(tableBlock[1]).not.toMatch(/REFERENCES/i);
		expect(tableBlock[1]).not.toMatch(/candidate_id/i);
		expect(tableBlock[1]).not.toMatch(/user_id/i);
	});

	test('AC-2: creates biometric_session_map as the only authorized join path', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS biometric_session_map/);
		expect(src).toMatch(/interview_session_id INTEGER NOT NULL REFERENCES interview_sessions/);
		expect(src).toMatch(/subject_ref/);
	});

	test('every DDL statement is idempotent (IF NOT EXISTS)', () => {
		const createTables = src.match(/CREATE TABLE /g) || [];
		const createTableIfNotExists = src.match(/CREATE TABLE IF NOT EXISTS /g) || [];
		expect(createTables.length).toBeGreaterThan(0);
		expect(createTableIfNotExists.length).toBe(createTables.length);
	});

	test('AC-2: biometric_templates.subject_ref is UNIQUE (no collisions)', () => {
		expect(src).toMatch(/subject_ref BYTEA NOT NULL UNIQUE/);
	});

	test('honest scope: backup limitation documented (not claiming backup-proof)', () => {
		expect(src).toMatch(/HONEST SCOPE/);
		expect(src).not.toMatch(/unrecoverable, including in database backups/);
	});
});
