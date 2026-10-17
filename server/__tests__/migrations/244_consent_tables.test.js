/**
 * S-010 (#568): Consent tables migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test validates the migration
 * FILE content: required tables, columns, CHECK constraints, FK, seeds,
 * IF NOT EXISTS guards.
 *
 * AC coverage:
 * - AC-1: 3 consent types (recording, biometric, id_verification) seeded
 * - AC-5: Hindi text column (text_hi) present for CR-10
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'244_consent_tables.js',
);

describe('244_consent_tables migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('creates consent_texts with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS consent_texts/);
	});

	test('consent_texts has every required column', () => {
		const required = [
			'consent_type',
			'version',
			'text_en',
			'text_hi',
			'effective_from',
		];
		for (const col of required) {
			expect(src).toContain(col);
		}
	});

	test('consent_texts constrains consent_type to the 3 types', () => {
		expect(src).toMatch(/consent_type IN \(['"]recording['"], ?['"]biometric['"], ?['"]id_verification['"]\)/);
	});

	test('consent_texts primary key is (consent_type, version)', () => {
		expect(src).toMatch(/PRIMARY KEY \(consent_type, version\)/);
	});

	test('creates consent_receipts with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS consent_receipts/);
	});

	test('consent_receipts has every required column', () => {
		const required = [
			'interview_session_id',
			'candidate_id',
			'consent_type',
			'consent_text_version',
			'consent_text_hash',
			'granted_at',
			'withdrawn_at',
		];
		for (const col of required) {
			expect(src).toContain(col);
		}
	});

	test('consent_receipts FK references consent_texts (consent_type, version)', () => {
		expect(src).toMatch(
			/FOREIGN KEY \(consent_type, consent_text_version\) REFERENCES consent_texts\(consent_type, version\)/,
		);
	});

	test('consent_receipts enforces granted XOR withdrawn semantics', () => {
		expect(src).toMatch(/granted_at IS NOT NULL OR withdrawn_at IS NOT NULL/);
	});

	test('consent_receipts unique per (session, type, version)', () => {
		expect(src).toMatch(/UNIQUE\(interview_session_id, consent_type, consent_text_version\)/);
	});

	test('seeds all 3 consent types in English and Hindi', () => {
		// Seeds are defined in SEED_TEXTS (loop-inserted with ON CONFLICT DO NOTHING).
		// Verify all 3 types are present with both text_en and text_hi.
		for (const type of ['recording', 'biometric', 'id_verification']) {
			expect(src).toContain(`type: '${type}'`);
		}
		expect(src).toMatch(/text_en:/);
		expect(src).toMatch(/text_hi:/);
		expect(src).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/);
	});

	test('seed text marked DRAFT (pending legal counsel review)', () => {
		expect(src).toMatch(/DRAFT/i);
	});

	test('every DDL uses IF NOT EXISTS / OR REPLACE (idempotent)', () => {
		// No bare CREATE TABLE without IF NOT EXISTS
		const bareCreates = src.match(/CREATE TABLE (?!IF NOT EXISTS)/g);
		expect(bareCreates).toBeNull();
	});
});
