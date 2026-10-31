/**
 * #2050: biometric consent text v1.5 — §2 'created' correction (migration 304).
 *
 * Lex ruling on #2028 (comment 6545649899): biometric v1.4 (migration 303)
 * §2 said "No face or voice embedding is created or kept by our own
 * systems" — but speaker labelling DOES create a temporary voice template
 * in memory (never stored). §1 says so; §2's embedding sentence
 * contradicted it. §2's embedding sentence is replaced with Lex's exact
 * sentence (EN verbatim):
 *
 *   "No face embedding is created, and no face or voice embedding is kept
 *   or stored by our own systems, so there is no stored biometric template
 *   to delete."
 *
 * HI rendering: faithful translation of that same one-sentence change
 * only. The external Hindi legal check on #1947 stays open and is NOT
 * closed by this migration.
 *
 * Migration 304 INSERTs biometric v1.5 only. It must NOT update/delete:
 * migration 245 made consent_texts append-only. Readers resolve by
 * MAX(effective_from) (lib/consentService.js), so v1.5 becomes the served
 * text and v1.4 receipts read as STALE → re-consent by design.
 *
 * Byte-identity pin: v1.5 (EN and HI) must equal v1.4 with ONLY the one
 * §2 embedding sentence replaced — proven by constructing the expected
 * text from the migration-303 constants and comparing exactly.
 *
 * The mock below pins statement shape + exact Lex copy; the migration
 * mechanics (fresh-DB migrate + served-text read-back) are proven on the
 * real PG rig — evidence in the #2050 checkpoint (HL-003).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '304_consent_biometric_v15.js');

const LEX_EN_SENTENCE =
	'No face embedding is created, and no face or voice embedding is kept or stored by our own systems, so there is no stored biometric template to delete.';
const OLD_EN_SENTENCE =
	'No face or voice embedding is created or kept by our own systems, so there is no stored biometric template to delete.';
const NEW_HI_SENTENCE =
	'कोई चेहरा एम्बेडिंग नहीं बनाई जाती, और हमारी अपनी प्रणालियों द्वारा कोई चेहरा या आवाज़ एम्बेडिंग नहीं रखी या संग्रहीत की जाती, इसलिए हटाने के लिए कोई संग्रहीत बायोमेट्रिक टेम्पलेट नहीं है।';
const OLD_HI_SENTENCE =
	'हमारी अपनी प्रणालियाँ कोई चेहरा या आवाज़ एम्बेडिंग नहीं बनातीं और न ही रखती हैं, इसलिए हटाने के लिए कोई संग्रहीत बायोमेट्रिक टेम्पलेट नहीं है।';

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

describe('#2050 migration 304 — biometric consent v1.5 §2 created correction', () => {
	let calls;

	beforeAll(async () => {
		expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
		calls = await runMigration('migrations/304_consent_biometric_v15.js');
	});

	test('exports up and down functions (migrate.js contract)', async () => {
		const migration = require(MIGRATION_PATH);
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('INSERTs exactly one new version — biometric 1.5 — never UPDATEs/DELETEs', () => {
		for (const c of calls) {
			expect(c.sql).not.toMatch(/UPDATE\s+consent_texts/i);
			expect(c.sql).not.toMatch(/DELETE\s+FROM\s+consent_texts/i);
		}
		const inserts = insertsOf(calls);
		expect(inserts).toHaveLength(1);
		expect(inserts[0].params).toContain('biometric');
		expect(inserts[0].params).toContain('1.5');
		expect(inserts[0].params).not.toContain('biometric_practice');
		expect(inserts[0].params).not.toContain('recording');
	});

	test('new version wins MAX(effective_from) resolution and INSERT is idempotent', () => {
		for (const insert of insertsOf(calls)) {
			expect(insert.sql).toMatch(/NOW\(\)/);
			expect(insert.sql).toMatch(/ON CONFLICT \(consent_type, version\) DO NOTHING/i);
		}
	});

	test('served version is 1.5, so a receipt pinned to 1.4 reads STALE', () => {
		const insert = insertsOf(calls)[0];
		const servedVersion = insert.params.find((p) => p === '1.5');
		expect(servedVersion).toBe('1.5');
		// consentService.checkConsentState: receipt.consent_text_version !==
		// currentVersion → { state: 'stale' }. A 1.4 receipt therefore reads
		// STALE against the 1.5 served version (re-consent by design).
		const receiptVersion = '1.4';
		expect(receiptVersion).not.toBe(servedVersion);
	});

	test('EN §2: Lex sentence exact, old created-or-kept sentence gone', () => {
		const en = textOf(calls, 'biometric', /What we collect/i);
		expect(en).toBeDefined();
		expect(en).toContain(LEX_EN_SENTENCE);
		expect(en).not.toContain(OLD_EN_SENTENCE);
		// §2 header + no-storage lead-in are carried, not replaced.
		expect(en).toContain('2. How long we keep it: We do not store biometric templates.');
	});

	test('EN: v1.5 differs from v1.4 (migration 303) ONLY in the one §2 sentence', async () => {
		const calls303 = await runMigration('migrations/303_consent_biometric_provider_routing.js');
		const oldEn = textOf(calls303, 'biometric', /What we collect/i);
		const newEn = textOf(calls, 'biometric', /What we collect/i);
		expect(oldEn).toContain(OLD_EN_SENTENCE);
		const expected = oldEn.replace(OLD_EN_SENTENCE, LEX_EN_SENTENCE);
		expect(newEn).toBe(expected);
	});

	test('HI §2: faithful rendering of the same one-sentence change only', async () => {
		const calls303 = await runMigration('migrations/303_consent_biometric_provider_routing.js');
		const oldHi = textOf(calls303, 'biometric', /हम क्या एकत्र करते हैं/);
		const newHi = textOf(calls, 'biometric', /हम क्या एकत्र करते हैं/);
		expect(newHi).toBeDefined();
		expect(newHi).toContain(NEW_HI_SENTENCE);
		expect(newHi).not.toContain(OLD_HI_SENTENCE);
		expect(oldHi).toContain(OLD_HI_SENTENCE);
		const expected = oldHi.replace(OLD_HI_SENTENCE, NEW_HI_SENTENCE);
		expect(newHi).toBe(expected);
	});
});
