/**
 * S-011 (#571): Consent hardening migration — static content validation.
 *
 * Validates migration 245 addresses privacy-engineering findings:
 * - C2: drops the FK from consent_receipts to interview_sessions
 * - M1: consent_texts append-only trigger (no UPDATE/DELETE)
 * - M3: biometric_audit_log action enum extended with consent lifecycle actions
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'245_consent_hardening.js',
);

describe('245_consent_hardening migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('C2: drops the FK constraint on consent_receipts.interview_session_id', () => {
		expect(src).toMatch(/DROP CONSTRAINT/);
		expect(src).toMatch(/consent_receipts/);
		expect(src).toMatch(/interview_session_id/);
	});

	test('M1: creates append-only trigger function for consent_texts', () => {
		expect(src).toMatch(/prevent_consent_text_mutation/);
		expect(src).toMatch(/RAISE EXCEPTION/);
	});

	test('M1: trigger blocks UPDATE OR DELETE on consent_texts', () => {
		expect(src).toMatch(/BEFORE UPDATE OR DELETE ON consent_texts/);
		expect(src).toMatch(/trg_consent_texts_no_update/);
	});

	test('M3: extends biometric_audit_log action check with consent actions', () => {
		expect(src).toMatch(/consent_granted/);
		expect(src).toMatch(/consent_declined/);
		expect(src).toMatch(/consent_withdrawn/);
	});

	test('M3: preserves existing actions in the new check', () => {
		expect(src).toMatch(/'view', 'export', 'delete', 'purge'/);
	});

	test('all DDL is idempotent (IF NOT EXISTS / OR REPLACE / conditional drops)', () => {
		expect(src).toMatch(/CREATE OR REPLACE FUNCTION/);
		expect(src).toMatch(/DROP TRIGGER IF EXISTS/);
		expect(src).toMatch(/IF chk_name IS NOT NULL/);
		expect(src).toMatch(/IF fk_name IS NOT NULL/);
	});
});
