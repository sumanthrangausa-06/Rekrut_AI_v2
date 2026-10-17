/**
 * #1306 — real-DB integration test for consentService.recordConsent.
 *
 * Bug B: POST /api/consent/record failed live with
 * "inconsistent types deduced for parameter $3". The existing unit tests
 * mock lib/db, so Postgres parameter-type deduction — the layer where
 * this bug lives — was never exercised. This test uses NO mocks: it runs
 * the real consentService against a real Postgres and reads the receipt
 * row back.
 *
 * Schema shapes under test (STOP 1 on #1306):
 *  - "fresh": migration 244 shape — consent_texts.consent_type and
 *    consent_receipts.consent_type are both VARCHAR(30).
 *  - "drift-texts-text": live-drift reproduction — consent_texts is TEXT,
 *    consent_receipts stays VARCHAR(30).
 *  - "drift-receipts-text": reverse drift — consent_texts VARCHAR(30),
 *    consent_receipts TEXT.
 * The uncast query must fail on untyped parameters (node-pg sends strings
 * with no type OID, exactly like production); the fixed query must record
 * accept AND decline in every shape.
 *
 * #1315: the hand-built consent_receipts schema below now carries BOTH
 * real migration-244 CHECK constraints verbatim, so this suite represents
 * the PRE-268 world faithfully (the earlier hand-built schema omitted
 * them, which is how the decline bug hid). buildSchema applies migration
 * 268's up() to the test DB by default — applying 268 is what turns the
 * decline test green. One dedicated test below builds the schema WITHOUT
 * 268 and asserts a decline still violates the ordering CHECK, keeping
 * the red proof in-suite.
 *
 * Gated behind CONSENT_INTEGRATION_DB_URL so CI (no DB) skips gracefully.
 * Example:
 *   CONSENT_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:5432/rekrut_1306_it' \
 *     npx jest server/__tests__/lib/consentService.integration.test.js --forceExit
 */

// NOTE: no jest.mock calls in this file — real modules, real DB.
// server/test/setup.js globally mocks ../../lib/db for every test file;
// unmock it here so consentService gets the REAL pool (same pattern as
// retention-audit-integration.test.js).
jest.unmock('../../../lib/db');

const mig268 = require('../../../migrations/268_consent_receipts_decline');

const DB_URL = process.env.CONSENT_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const SHAPES = [
	{ name: 'fresh (migration 244: both VARCHAR(30))', textsType: 'VARCHAR(30)', receiptsType: 'VARCHAR(30)' },
	{ name: 'drift (consent_texts TEXT, consent_receipts VARCHAR(30))', textsType: 'TEXT', receiptsType: 'VARCHAR(30)' },
	{ name: 'drift (consent_texts VARCHAR(30), consent_receipts TEXT)', textsType: 'VARCHAR(30)', receiptsType: 'TEXT' },
];

describeIfDb('consentService.recordConsent (real DB — #1306)', () => {
	let pool;
	let consentService;

	async function buildSchema({ textsType, receiptsType }, { apply268 = true } = {}) {
		await pool.query(`DROP TABLE IF EXISTS consent_receipts`);
		await pool.query(`DROP TABLE IF EXISTS consent_texts`);
		await pool.query(`DROP TABLE IF EXISTS interview_sessions`);
		await pool.query(`DROP TABLE IF EXISTS biometric_audit_log`);
		await pool.query(`
			CREATE TABLE interview_sessions (
				id SERIAL PRIMARY KEY,
				candidate_id INTEGER,
				company_id INTEGER,
				config JSONB NOT NULL DEFAULT '{}'::jsonb
			)`);
		await pool.query(`
			CREATE TABLE consent_texts (
				consent_type ${textsType} NOT NULL,
				version VARCHAR(20) NOT NULL,
				text_en TEXT NOT NULL,
				text_hi TEXT NOT NULL,
				effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				PRIMARY KEY (consent_type, version)
			)`);
		await pool.query(`
			CREATE TABLE consent_receipts (
				id SERIAL PRIMARY KEY,
				interview_session_id INTEGER NOT NULL,
				candidate_id INTEGER NOT NULL,
				consent_type ${receiptsType} NOT NULL,
				consent_text_version VARCHAR(20) NOT NULL,
				consent_text_hash VARCHAR(64) NOT NULL,
				granted_at TIMESTAMPTZ,
				withdrawn_at TIMESTAMPTZ,
				CHECK (granted_at IS NOT NULL OR withdrawn_at IS NOT NULL),
				CHECK (withdrawn_at IS NULL OR (granted_at IS NOT NULL AND withdrawn_at >= granted_at)),
				FOREIGN KEY (consent_type, consent_text_version)
					REFERENCES consent_texts (consent_type, version),
				UNIQUE (interview_session_id, consent_type, consent_text_version)
			)`);
		await pool.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi) VALUES
			 ('biometric_practice', '1.0', 'practice text', 'practice text'),
			 ('recording', '1.0', 'recording text', 'recording text')`,
		);
		await pool.query(`INSERT INTO interview_sessions (id, candidate_id, company_id) VALUES (42, 7, 55), (43, 7, 55)`);
		// Post-268 world by default; the pre-268 red-proof test opts out.
		if (apply268) await mig268.up(pool);
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		consentService = require('../../../lib/consentService');
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	for (const shape of SHAPES) {
		describe(`schema shape: ${shape.name}`, () => {
			beforeEach(async () => {
				await buildSchema(shape);
			});

			test('accept records a granted receipt (biometric_practice) and it reads back', async () => {
				const receipt = await consentService.recordConsent({
					sessionId: 42,
					candidateId: 7,
					type: 'biometric_practice',
					accepted: true,
					locale: 'en',
					ipAddress: '127.0.0.1',
				});
				expect(receipt.id).toBeDefined();
				const { rows } = await pool.query(
					`SELECT consent_type, granted_at, withdrawn_at FROM consent_receipts WHERE id = $1`,
					[receipt.id],
				);
				expect(rows).toHaveLength(1);
				expect(rows[0].consent_type).toBe('biometric_practice');
				expect(rows[0].granted_at).not.toBeNull();
				expect(rows[0].withdrawn_at).toBeNull();
			});

			test('decline records a withdrawn receipt (audit trail has no hole)', async () => {
				const receipt = await consentService.recordConsent({
					sessionId: 43,
					candidateId: 7,
					type: 'biometric_practice',
					accepted: false,
					locale: 'en',
					ipAddress: '127.0.0.1',
				});
				const { rows } = await pool.query(
					`SELECT granted_at, withdrawn_at FROM consent_receipts WHERE id = $1`,
					[receipt.id],
				);
				expect(rows).toHaveLength(1);
				expect(rows[0].granted_at).toBeNull();
				expect(rows[0].withdrawn_at).not.toBeNull();
			});

			test('interview consent type (recording) accept also records', async () => {
				const receipt = await consentService.recordConsent({
					sessionId: 42,
					candidateId: 7,
					type: 'recording',
					accepted: true,
					locale: 'en',
					ipAddress: '127.0.0.1',
				});
				const { rows } = await pool.query(`SELECT id FROM consent_receipts WHERE id = $1`, [receipt.id]);
				expect(rows).toHaveLength(1);
			});
		});
	}

	describe('pre-268 world (real 244 CHECKs, migration 268 NOT applied) — #1315 red proof', () => {
		beforeEach(async () => {
			await buildSchema(SHAPES[0], { apply268: false });
		});

		test('decline rejects with a check-constraint violation (declines could never be stored)', async () => {
			await expect(
				consentService.recordConsent({
					sessionId: 43,
					candidateId: 7,
					type: 'biometric_practice',
					accepted: false,
					locale: 'en',
					ipAddress: '127.0.0.1',
				}),
			).rejects.toThrow(/violates check constraint/);
		});
	});
});
