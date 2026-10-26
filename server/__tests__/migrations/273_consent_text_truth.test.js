/**
 * #1563 + #1564 (combined lane): seeded consent texts repeat two false claims.
 *
 * #1563 — migration 244's `biometric` v1.0 text (EN + HI) states per-turn
 * behavioral measurements are "deleted with the video recording". FALSE:
 * observer speech measurements purge on their own 30-day rule
 * (EuComplianceService.purgeExpiredSpeechMeasurements,
 * services/euComplianceService.js — data_retention_policies row
 * 'observer_audio' = 30 days, migration 257; cutoff on the measurements'
 * own created_at), gated by RETENTION_PURGE_LIVE dry-run default, so
 * automated deletion is not yet enabled. The #1562-merged policy page
 * (client/src/pages/biometric-policy.tsx) already states this truthfully.
 *
 * #1564 — "Deletion is completed within 30 days" (EN) / "30 दिनों के भीतर
 * हटाना पूर्ण किया जाता है" (HI) appears in migration 244's `recording` and
 * `biometric` v1.0 §3 and migration 250's `biometric_practice` v1.0 §3.
 * Reviewer BLOCK on PR #1560 (comment 6320517942): no code implements a
 * 30-day deletion-COMPLETION SLA; deletion-on-request is a manual email
 * route. The only supported timeframe is the #1556-merged respond window:
 * "We respond to deletion requests within 30 days (GDPR) or 45 days
 * (CCPA)" (biometric-policy.tsx) — respond ≠ completed.
 *
 * Migration 273 INSERTs NEW consent_texts version '1.1' rows for all three
 * types (EN + HI). It does NOT update the v1.0 rows: migration 245 made
 * consent_texts append-only (trigger trg_consent_texts_no_update rejects
 * every UPDATE/DELETE), and every current-version reader resolves by
 * MAX(effective_from) (lib/consentService.js getConsentText /
 * getCurrentTextVersion; GET /api/consent/texts/:type), so v1.1 becomes
 * the served text while consent_receipts stay pinned to v1.0.
 *
 * The mock below captures statements and pins the statement SHAPE and the
 * exact copy; it is NOT the migration-mechanics proof on its own (the
 * #1306 / Quinn HL-003 lesson). Migration 273 is additionally proven
 * against a real fresh-install database (node migrate.js on an empty DB,
 * read-back via GET /api/consent/texts/:type) — evidence on #1563/#1564.
 *
 * This test fails on pre-fix code: migration 273 does not exist and the
 * current v1.0 texts for all three types contain the false claims.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '273_consent_recording_biometric_text_truth.js');

const TYPES = ['recording', 'biometric', 'biometric_practice'];

// Affirmative false claims — must not appear in ANY corrected text.
const COMPLETION_EN = [/deletion is completed within/i, /completed within 30 days/i];
const COMPLETION_HI = [/हटाना पूर्ण/, /पूर्ण किया जाता है/];
// Affirmative linkage only: the corrected text must explicitly DENY the
// linkage ("they are not deleted with the video recording"), so the ban
// targets the affirmative form "are deleted with the video recording"
// (the 272-test narrowing precedent for required denial sentences).
const PER_TURN_LINKAGE_EN = [/are deleted with the video recording/i];
const PER_TURN_LINKAGE_HI = [/वीडियो रिकॉर्डिंग के साथ हटा दिए जाते हैं/, /वीडियो रिकॉर्डिंग के साथ हटाए जाते हैं/];

const RESPOND_EN = /respond to deletion requests within 30 days \(GDPR\) or 45 days \(CCPA\)/i;
const RESPOND_HI_PARTS = [/जवाब देते हैं/, /30 दिनों/, /45 दिनों/, /GDPR/, /CCPA/];

describe('#1563/#1564 migration 273 — corrected consent texts (recording, biometric, biometric_practice)', () => {
	let migration;
	let calls;

	beforeAll(async () => {
		expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
		migration = require(MIGRATION_PATH);
		calls = [];
		const client = {
			query: async (sql, params) => {
				calls.push({ sql, params });
				return { rows: [], rowCount: 1 };
			},
		};
		await migration.up(client);
	});

	const getInserts = () => calls.filter((c) => /INSERT INTO consent_texts/i.test(c.sql));
	const getInsertFor = (type) => getInserts().find((c) => c.params && c.params.includes(type));
	const getText = (type, marker) => {
		const insert = getInsertFor(type);
		if (!insert) return undefined;
		return insert.params.find((p) => typeof p === 'string' && marker.test(p));
	};
	const getTextEn = (type) => getText(type, /What we collect|What we collect:|How long we keep it/i) || getText(type, /DRAFT — pending legal counsel review/);
	const getTextHi = (type) => getText(type, /हम क्या एकत्र करते हैं/);

	test('exports up and down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('HL-003: INSERTs a NEW version 1.1 for each affected type — never UPDATEs/DELETEs the append-only table', () => {
		for (const c of calls) {
			expect(c.sql).not.toMatch(/UPDATE\s+consent_texts/i);
			expect(c.sql).not.toMatch(/DELETE\s+FROM\s+consent_texts/i);
		}
		expect(getInserts()).toHaveLength(3);
		for (const type of TYPES) {
			const insert = getInsertFor(type);
			expect(insert).toBeDefined();
			expect(insert.params).toContain('1.1');
			expect(insert.params).not.toContain('1.0');
		}
	});

	test('HL-003: new versions win MAX(effective_from) resolution and INSERTs are idempotent', () => {
		for (const insert of getInserts()) {
			expect(insert.sql).toMatch(/effective_from/i);
			expect(insert.sql).toMatch(/NOW\(\)/);
			expect(insert.sql).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/i);
		}
	});

	test('#1564: no corrected text (any type, EN or HI) contains a deletion completion-timeframe claim', () => {
		for (const type of TYPES) {
			const textEn = getTextEn(type);
			const textHi = getTextHi(type);
			expect(textEn).toBeDefined();
			expect(textHi).toBeDefined();
			for (const claim of COMPLETION_EN) expect(textEn).not.toMatch(claim);
			for (const claim of COMPLETION_HI) expect(textHi).not.toMatch(claim);
		}
	});

	test('#1564: every corrected §3 states the supported respond window (30 days GDPR / 45 days CCPA), EN + HI', () => {
		for (const type of TYPES) {
			const textEn = getTextEn(type);
			const textHi = getTextHi(type);
			expect(textEn).toMatch(RESPOND_EN);
			expect(textEn).toMatch(/privacy@rekrutai\.co/);
			for (const part of RESPOND_HI_PARTS) expect(textHi).toMatch(part);
			expect(textHi).toMatch(/privacy@rekrutai\.co/);
		}
	});

	test('#1563: corrected biometric text drops the recording-linked per-turn claim (EN + HI)', () => {
		const textEn = getTextEn('biometric');
		const textHi = getTextHi('biometric');
		for (const claim of PER_TURN_LINKAGE_EN) expect(textEn).not.toMatch(claim);
		for (const claim of PER_TURN_LINKAGE_HI) expect(textHi).not.toMatch(claim);
	});

	test('#1563: corrected biometric text states the truthful own-rule for observer speech measurements (EN + HI)', () => {
		const textEn = getTextEn('biometric');
		const textHi = getTextHi('biometric');
		expect(textEn).toMatch(/Observer speech measurements are kept for up to 30 days from when they were recorded/i);
		expect(textEn).toMatch(/not deleted with the video recording/i);
		expect(textEn).toMatch(/Automated deletion at expiry is not yet enabled/i);
		expect(textHi).toMatch(/30 दिनों तक/);
		expect(textHi).toMatch(/वीडियो रिकॉर्डिंग के साथ नहीं हटाए जाते/);
		expect(textHi).toMatch(/स्वचालित हटाना अभी तक सक्षम नहीं है/);
	});

	test('out-of-scope copy is carried verbatim: recording retention, biometric rights, practice rights (EN)', () => {
		expect(getTextEn('recording')).toMatch(/deleted 90 days after the hiring decision is finalized/i);
		expect(getTextEn('recording')).toMatch(/interview session cannot start/i);
		expect(getTextEn('biometric')).toMatch(/request a human-led interview instead/i);
		expect(getTextEn('biometric')).toMatch(/will not affect your candidacy/i);
		expect(getTextEn('biometric_practice')).toMatch(/practice with a text response instead/i);
		expect(getTextEn('biometric_practice')).toMatch(/full coaching feedback/i);
	});

	test('corrected texts keep the DRAFT pending legal counsel review marking (EN + HI)', () => {
		for (const type of TYPES) {
			expect(getTextEn(type)).toMatch(/DRAFT — pending legal counsel review/);
			expect(getTextHi(type)).toMatch(/कानूनी सलाहकार की समीक्षा लंबित/);
		}
	});
});
