/**
 * S-D15 (#1917, epic #1900): biometric consent text v1.2 — diarization disclosure.
 *
 * AC-1: the `biometric` consent text is version-bumped to disclose speaker
 * labelling in Lex's plain words (BR-6, LEX-POSITION §2.2 canonical sentence):
 * a temporary mathematical template of each speaker's voice is created during
 * processing only and is never stored; who sees the labels. Delivered as a
 * clause within the existing `biometric` type via version bump (CF-4), NOT a
 * new consent type.
 *
 * Migration 297 INSERTs a new version '1.2' row for `biometric` only. It must
 * NOT update/delete: migration 245 made consent_texts append-only (trigger
 * trg_consent_texts_no_update). Every current-version reader resolves by
 * MAX(effective_from) (lib/consentService.js), so v1.2 becomes the served text
 * and v1.1 receipts read as STALE → CONSENT_VERSION_STALE re-consent.
 *
 * The mock below pins statement shape + exact Lex copy; the migration
 * mechanics (fresh-DB migrate + stale-receipt behaviour) are proven on the
 * real PG rig — evidence in the S-D15 build log (HL-003).
 *
 * This test fails on pre-fix code: migration 297 does not exist and the
 * current v1.1 biometric text contains no diarization disclosure.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '297_consent_biometric_diarization_text.js');

describe('S-D15 migration 297 — biometric consent v1.2 diarization disclosure (#1917)', () => {
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
	const getTextEn = () => {
		const insert = getInserts()[0];
		return insert?.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
	};
	const getTextHi = () => {
		const insert = getInserts()[0];
		return insert?.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
	};

	test('exports up and down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('INSERTs exactly one new version — biometric v1.2 — never UPDATEs/DELETEs the append-only table', () => {
		for (const c of calls) {
			expect(c.sql).not.toMatch(/UPDATE\s+consent_texts/i);
			expect(c.sql).not.toMatch(/DELETE\s+FROM\s+consent_texts/i);
		}
		expect(getInserts()).toHaveLength(1);
		const insert = getInserts()[0];
		expect(insert.params).toContain('biometric');
		expect(insert.params).toContain('1.2');
		expect(insert.params).not.toContain('1.1');
		// CF-4: no other consent type is touched by this bump.
		expect(insert.params).not.toContain('recording');
		expect(insert.params).not.toContain('biometric_practice');
	});

	test('new version wins MAX(effective_from) resolution and INSERT is idempotent', () => {
		const insert = getInserts()[0];
		expect(insert.sql).toMatch(/NOW\(\)/);
		expect(insert.sql).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/i);
	});

	test('EN text carries the BR-6 canonical disclosure (temporary template, never stored)', () => {
		const en = getTextEn();
		expect(en).toBeDefined();
		expect(en).toMatch(/temporary mathematical template of each speaker's voice during processing/i);
		expect(en).toMatch(/template exists only while the labelling runs and is never stored/i);
		expect(en).toMatch(/never compared with any other recording/i);
	});

	test('EN text says who sees the labels and the presentation-only fence (BR-12)', () => {
		const en = getTextEn();
		expect(en).toMatch(/only by you and by the members of the hiring team who can already access/i);
		expect(en).toMatch(/never used in any score, rating, or matching decision/i);
	});

	test('EN text keeps v1.1 honesty: DRAFT marking, respond window, no completion SLA, decline = no labelling', () => {
		const en = getTextEn();
		expect(en).toMatch(/DRAFT — pending legal counsel review/);
		expect(en).toMatch(/respond to deletion requests within 30 days \(GDPR\) or 45 days \(CCPA\)/i);
		expect(en).not.toMatch(/deletion is completed within/i);
		expect(en).toMatch(/Declining also means no speaker labelling/i);
		expect(en).toMatch(/Automated deletion at expiry is not yet enabled/i);
		// v1.2 §2 carve-out: the labelling template is excepted from the stored-template sentence.
		expect(en).toMatch(/never stored at all/i);
	});

	test('v1.1 text is carried verbatim: every v1.1 paragraph is intact or an exact prefix in v1.2 (EN + HI)', async () => {
		// Reviewer Minor-5 pin: a future silent edit to carried §1/§3 wording
		// must fail here. v1.2 may only APPEND to a v1.1 paragraph (§2 and
		// Your-rights) or add whole new paragraphs — never rewrite carried text.
		const mig273 = require(path.join(ROOT, 'migrations', '273_consent_recording_biometric_text_truth.js'));
		const calls273 = [];
		const client273 = {
			query: async (sql, params) => {
				calls273.push({ sql, params });
				return { rows: [], rowCount: 1 };
			},
		};
		await mig273.up(client273);
		const insert273 = calls273.find((c) => /INSERT INTO consent_texts/i.test(c.sql) && c.params.includes('biometric'));
		const oldEn = insert273.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		const oldHi = insert273.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		const carried = (oldText, newText) => {
			const newParas = newText.split('\n\n');
			for (const para of oldText.split('\n\n')) {
				const ok = newText.includes(para) || newParas.some((np) => np.startsWith(para));
				if (!ok) return para;
			}
			return null;
		};
		expect(carried(oldEn, getTextEn())).toBeNull();
		expect(carried(oldHi, getTextHi())).toBeNull();
	});

	test('HI text carries the same disclosure (canonical sentence rendered in Hindi)', () => {
		const hi = getTextHi();
		expect(hi).toBeDefined();
		expect(hi).toMatch(/वक्ता लेबल/);
		expect(hi).toMatch(/अस्थायी गणितीय टेम्पलेट/);
		expect(hi).toMatch(/कभी संग्रहीत नहीं किया जाता/);
		expect(hi).toMatch(/DRAFT — कानूनी सलाहकार की समीक्षा लंबित/);
		expect(hi).not.toMatch(/हटाना पूर्ण/);
	});
});
