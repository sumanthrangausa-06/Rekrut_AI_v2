/**
 * S-066 (#719): QP biometric consent text migration — static content validation.
 *
 * Migration 250 adds the 'biometric_practice' consent type with QP-specific
 * copy (C-1: the interview 'biometric' text is misleading for practice users —
 * BIPA §15(b) informed-consent risk).
 *
 * Key design points:
 *   - Separate type, NOT a version bump of 'biometric' (bumping would
 *     stale-out every existing interview receipt).
 *   - Text is DRAFT — pending legal counsel review (standing Phase-3 gate).
 *   - All DDL must be idempotent.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'250_qp_biometric_consent_text.js',
);

describe('250_qp_biometric_consent_text migration', () => {
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

	test('widens the consent_texts CHECK constraint to include biometric_practice', () => {
		expect(src).toMatch(/biometric_practice/);
		expect(src).toMatch(/CHECK \(consent_type IN \([^)]*biometric_practice[^)]*\)/);
	});

	test('constraint change is idempotent (DROP IF EXISTS)', () => {
		expect(src).toMatch(/DROP CONSTRAINT IF EXISTS/);
	});

	test('inserts QP-specific text as version 1.0 (idempotent)', () => {
		expect(src).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/);
		expect(src).toMatch(/'biometric_practice', '1\.0'/);
	});

	test('QP text does not reference hiring decisions or candidacy (C-1)', () => {
		// The interview text's BIPA-risk phrases must NOT appear in QP copy.
		const textMatch = src.match(/QP_BIOMETRIC_TEXT_EN = `([\s\S]*?)`;/);
		expect(textMatch).not.toBeNull();
		const qpText = textMatch[1];
		expect(qpText).not.toMatch(/hiring decision/i);
		expect(qpText).not.toMatch(/candidacy/i);
		expect(qpText).not.toMatch(/human-led interview instead/i);
		// QP text routes to text-mode practice instead.
		expect(qpText).toMatch(/text response/i);
	});

	test('QP text is marked DRAFT pending legal review', () => {
		expect(src).toMatch(/DRAFT — pending legal counsel review/);
	});

	test('QP text includes Hindi variant', () => {
		expect(src).toMatch(/QP_BIOMETRIC_TEXT_HI/);
	});

	test('down migration removes the QP text', () => {
		expect(src).toMatch(/DELETE FROM consent_texts WHERE consent_type = 'biometric_practice'/);
	});
});
