/**
 * #1947 (S-D15 residuals): biometric consent text correction — migration 302.
 *
 * AC: the served `biometric` text no longer claims measurements that shipped
 * code does not take, and no longer claims biometric templates are stored:
 *   - Item 1: §1 lists ONLY the shipped audio measurements (voice pitch
 *     range, speech rate, pause patterns — lib/observerSpeech.js) and states
 *     explicitly that face measurements are not extracted and gaze direction,
 *     blink rate, and head pose are not measured.
 *   - Item 2: §2's stored-template sentence ("Biometric templates
 *     (face/voice embeddings) are deleted when…") is replaced by the truth:
 *     no template is created or kept (verified: no INSERT INTO
 *     biometric_templates exists anywhere in the repo — the mig-246 table is
 *     only counted/purged). DELETE, not narrow: face templates are equally
 *     never stored, so narrowing to "face only" would keep a false claim.
 *   - Practice §1: `biometric_practice` carries the same false §1 list; v1.2
 *     corrects it to what the shipped flow does — an external AI provider
 *     returns coaching JUDGMENTS (eye contact, facial expressions, body
 *     language, professional appearance — the normalizeVisionResult fields
 *     in lib/qp-ai.js / lib/polsia-ai.js); Rekrut extracts no measurements.
 *   - Item 4 (policy §2 purpose bullet) is a client-page change, pinned by
 *     the client suites, not here.
 *
 * Wording is Lex's (STOP 1 on #1947, comment 6538636670 — Lex + privacy +
 * Rex panel), with one evidence-based deviation recorded there: the
 * provider-judgment list names only fields shipped code actually normalises.
 *
 * Migration 302 INSERTs biometric v1.3 + biometric_practice v1.2. It must
 * NOT update/delete: migration 245 made consent_texts append-only. Readers
 * resolve by MAX(effective_from) (lib/consentService.js), so the new rows
 * become the served texts and v1.2/v1.1 receipts read as STALE.
 *
 * The mock below pins statement shape + exact Lex copy; the migration
 * mechanics (fresh-DB migrate + served-text read-back) are proven on the
 * real PG rig — evidence in the #1947 build log (HL-003).
 *
 * This test fails on pre-fix code: migration 302 does not exist and the
 * current served biometric text (v1.2) contains the false §1 list and the
 * stored-template claim.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '302_consent_biometric_text_correction.js');

const OLD_COLLECTED_LIST =
	'facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose';
const OLD_TEMPLATE_SENTENCE = 'Biometric templates (face/voice embeddings) are deleted when';

async function runMigration(relPath) {
	const migration = require(path.join(ROOT, relPath));
	const calls = [];
	const client = {
		query: async (sql, params) => {
			calls.push({ sql, params });
			return { rows: [], rowCount: 1 };
		},
	};
	await migration.up(client);
	return calls;
}

const insertsOf = (calls) => calls.filter((c) => /INSERT INTO consent_texts/i.test(c.sql));
const textOf = (calls, type, langRe) => {
	const insert = insertsOf(calls).find((c) => c.params.includes(type));
	return insert?.params.find((p) => typeof p === 'string' && langRe.test(p));
};

describe('#1947 migration 302 — biometric v1.3 + biometric_practice v1.2 correction', () => {
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

	test('exports up and down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('INSERTs exactly two new versions — biometric 1.3, biometric_practice 1.2 — never UPDATEs/DELETEs', () => {
		for (const c of calls) {
			expect(c.sql).not.toMatch(/UPDATE\s+consent_texts/i);
			expect(c.sql).not.toMatch(/DELETE\s+FROM\s+consent_texts/i);
		}
		const inserts = insertsOf(calls);
		expect(inserts).toHaveLength(2);
		const bio = inserts.find((c) => c.params.includes('biometric'));
		const qp = inserts.find((c) => c.params.includes('biometric_practice'));
		expect(bio.params).toContain('1.3');
		expect(qp.params).toContain('1.2');
		// No other consent type is touched by this correction.
		expect(inserts.every((c) => !c.params.includes('recording'))).toBe(true);
		expect(inserts.every((c) => !c.params.includes('id_verification'))).toBe(true);
	});

	test('new versions win MAX(effective_from) resolution and INSERTs are idempotent', () => {
		for (const insert of insertsOf(calls)) {
			expect(insert.sql).toMatch(/NOW\(\)/);
			expect(insert.sql).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/i);
		}
	});

	test('biometric EN §1: audio-only list, explicit NOT list, false collected list gone', () => {
		const en = textOf(calls, 'biometric', /What we collect/i);
		expect(en).toBeDefined();
		expect(en).toMatch(
			/Biometric measurements extracted from your audio — voice pitch range, speech rate, and pause patterns\./,
		);
		expect(en).toMatch(/We do NOT extract face measurements from your video/);
		expect(en).toMatch(/gaze direction, blink rate, and head pose are not measured/);
		expect(en).not.toContain(OLD_COLLECTED_LIST);
		expect(en).not.toMatch(/extracted from your video and audio/);
	});

	test('biometric EN §2: stored-template claim deleted, no-storage truth + diarization carve-out kept', () => {
		const en = textOf(calls, 'biometric', /What we collect/i);
		expect(en).not.toContain(OLD_TEMPLATE_SENTENCE);
		expect(en).not.toMatch(/face\/voice embeddings\) are deleted/);
		expect(en).toMatch(/We do not store biometric templates\./);
		expect(en).toMatch(/No face or voice embedding is created or kept by our own systems/);
		expect(en).toMatch(/For clarity, speaker labelling is different/);
		// The diarization disclosure itself is untouched by the correction.
		expect(en).toMatch(/temporary mathematical template of each speaker's voice during processing/);
		expect(en).toMatch(/never used in any score, rating, or matching decision/);
		expect(en).toMatch(/Declining also means no speaker labelling/);
	});

	test('biometric EN: carried-verbatim — v1.3 differs from v1.2 ONLY in the ruled §1/§2 replacements', async () => {
		const calls297 = await runMigration('migrations/297_consent_biometric_diarization_text.js');
		const oldEn = textOf(calls297, 'biometric', /What we collect/i);
		const newEn = textOf(calls, 'biometric', /What we collect/i);
		const oldParas = oldEn.split('\n\n');
		const newParas = newEn.split('\n\n');
		expect(newParas).toHaveLength(oldParas.length);
		// Paragraphs: 0 DRAFT, 1 §1, 2 speaker labels, 3 §2, 4 §3, 5 rights.
		for (const idx of [0, 2, 4, 5]) {
			expect(newParas[idx]).toBe(oldParas[idx]);
		}
		// §1: only the first paragraph's measurement sentences changed.
		expect(newParas[1]).not.toBe(oldParas[1]);
		// §2: first sentence replaced + carve-out prefix; the rest verbatim.
		expect(newParas[3]).toContain(
			'Observer speech measurements are kept for up to 30 days from when they were recorded',
		);
		expect(newParas[3]).toContain(
			'The speaker labels themselves stay with the transcript for as long as the recording is kept',
		);
		const oldCarveOut = oldParas[3].split('Speaker labelling is different')[1];
		expect(newParas[3]).toContain(`speaker labelling is different${oldCarveOut}`);
	});

	test('biometric HI: same correction rendered (audio-only list, NOT list, no-storage §2)', () => {
		const hi = textOf(calls, 'biometric', /हम क्या एकत्र करते हैं/);
		expect(hi).toBeDefined();
		expect(hi).toMatch(/आपके ऑडियो से निकाले गए बायोमेट्रिक माप — आवाज़ की पिच रेंज, बोलने की गति और विराम पैटर्न/);
		expect(hi).toMatch(/चेहरे के माप नहीं निकालते/);
		expect(hi).toMatch(/दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति नहीं मापी जाती/);
		expect(hi).not.toContain('चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा');
		expect(hi).toMatch(/हम बायोमेट्रिक टेम्पलेट संग्रहीत नहीं करते/);
		expect(hi).toMatch(/DRAFT — कानूनी सलाहकार की समीक्षा लंबित/);
	});

	test('biometric_practice EN §1: provider-judgment framing, shipped fields only, false list gone', () => {
		const en = textOf(calls, 'biometric_practice', /What we collect/i);
		expect(en).toBeDefined();
		expect(en).toMatch(/reviewed by an external AI provider/);
		expect(en).toMatch(
			/coaching judgments about eye contact, facial expressions, body language, and professional appearance/,
		);
		expect(en).toMatch(/not measurements we extract ourselves/);
		expect(en).toMatch(/we do not measure gaze direction, blink rate, or head pose/);
		expect(en).not.toContain(OLD_COLLECTED_LIST);
		expect(en).not.toMatch(/Biometric measurements extracted from your practice video/);
	});

	test('biometric_practice: everything except §1 carries verbatim from v1.1 (incl. §2 retention bracket)', async () => {
		const calls273 = await runMigration('migrations/273_consent_recording_biometric_text_truth.js');
		const oldEn = textOf(calls273, 'biometric_practice', /What we collect/i);
		const oldHi = textOf(calls273, 'biometric_practice', /हम क्या एकत्र करते हैं/);
		const newEn = textOf(calls, 'biometric_practice', /What we collect/i);
		const newHi = textOf(calls, 'biometric_practice', /हम क्या एकत्र करते हैं/);
		// Paragraphs: 0 DRAFT, 1 §1, 2 §2, 3 §3, 4 rights — drop 0+1 (§1 is
		// the corrected paragraph; the DRAFT marking is identical anyway).
		const stripS1 = (t) => t.split('\n\n').slice(2).join('\n\n');
		expect(stripS1(newEn)).toBe(stripS1(oldEn));
		expect(stripS1(newHi)).toBe(stripS1(oldHi));
		expect(newEn).toMatch(/RETENTION TERM PENDING LEGAL REVIEW/);
		expect(newEn).toMatch(/practice with a text response instead/i);
	});

	test('biometric_practice HI §1: provider-judgment framing rendered', () => {
		const hi = textOf(calls, 'biometric_practice', /हम क्या एकत्र करते हैं/);
		expect(hi).toMatch(/बाहरी AI प्रदाता/);
		expect(hi).toMatch(/आंखों के संपर्क, चेहरे के भाव, शारीरिक भाषा और पेशेवर उपस्थिति/);
		expect(hi).not.toContain('चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज');
	});
});
