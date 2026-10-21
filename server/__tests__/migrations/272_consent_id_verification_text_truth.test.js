/**
 * #1559: Consent screen + seeded consent text falsely promised ID images are
 * "deleted within 24 hours of verification" and claimed a live facial capture
 * matches the ID photo (liveness check).
 *
 * Truth (verified on dev): lib/verification-config.js DEFAULT_RETENTION_DAYS
 * = 90; verification_requests.expires_at = NOW() + 90 days; NO automated
 * deletion job for verification_requests exists; no face-match/liveness code
 * exists for ID verification.
 *
 * Migration 272 UPDATEs the consent_texts row seeded by 244
 * (consent_type='id_verification', version='1.0') in EN + HI. 244 is already
 * applied and is NOT edited in place — fresh installs run 244 then 272.
 *
 * This test fails on pre-fix code: the UI page contains the 24-hour claim
 * and migration 272 does not exist.
 *
 * Review BLOCK on PR #1560 (comment 6320517942) — two further defects in
 * 272's own replacement text, both pinned here:
 *  1. "Deletion is completed within 30 days" (EN + HI) is unsupported: no
 *     code implements a completion SLA; deletion-on-request is a manual
 *     email route. biometric-policy.tsx (#1556) supports only "respond to
 *     deletion requests within 30 days (GDPR) or 45 days (CCPA)". Per the
 *     STOP 1 Lex premise, the corrected text states NO timeframe.
 *  2. routes/verification.js REQUIRES both id_document and selfie (400 if
 *     the selfie is missing) and stores selfie_encrypted_url in the same
 *     verification_requests row under the same 90-day expires_at; review is
 *     manual only, with no automated face-match/liveness. The corrected
 *     "What we collect" must disclose BOTH items with those facts.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '272_consent_id_verification_text_truth.js');
const PAGE_PATH = path.join(ROOT, 'client', 'src', 'pages', 'consent-screens.tsx');

// Affirmative false claims. Note: /liveness/i was narrowed to the affirmative
// capability-label form "(liveness check)" because the BLOCK-2 fix REQUIRES
// the corrected text to explicitly DENY liveness ("no automated
// face-matching or liveness check is performed") — the denial sentence is
// pinned verbatim by a positive assertion below, and /used to match/i +
// /facial capture/i still ban the original affirmative use claims.
const FALSE_CLAIMS_EN = [/24 hours/i, /24-hour/i, /\(liveness check\)/i, /used to match/i, /face match/i, /facial capture/i, /auto-delete/i, /auto delete/i];
const COMPLETION_CLAIMS_EN = [/completed within/i, /deletion is completed/i];
const COMPLETION_CLAIMS_HI = [/हटाना पूर्ण/, /पूर्ण किया जाता है/];
const FALSE_CLAIMS_HI = [/24 घंट/, /लाइवनेस/, /लाइव चेहरे/, /मिलान के लिए/, /स्वतः हट/];

describe('#1559 consent-screens.tsx — no false ID retention claims', () => {
	let page;
	beforeAll(() => {
		page = fs.readFileSync(PAGE_PATH, 'utf8');
	});

	test('does not claim ID images are deleted within 24 hours', () => {
		expect(page).not.toMatch(/24 hours/i);
		expect(page).not.toMatch(/24-hour/i);
	});

	test('states the true 90-day retention and deletion-on-request route', () => {
		expect(page).toMatch(/retained for 90 days/i);
		expect(page).toMatch(/privacy@rekrutai\.co/);
	});
});

describe('#1559 migration 272 — corrected id_verification consent text', () => {
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

	test('UPDATEs consent_texts for id_verification version 1.0 only', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		expect(update).toBeDefined();
		expect(update.sql).toMatch(/text_en/i);
		expect(update.sql).toMatch(/text_hi/i);
		expect(update.params).toContain('id_verification');
		expect(update.params).toContain('1.0');
	});

	test('corrected EN text has no 24-hour, face-match, or liveness claim', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		expect(textEn).toBeDefined();
		for (const claim of FALSE_CLAIMS_EN) {
			expect(textEn).not.toMatch(claim);
		}
	});

	test('corrected HI text has no 24-hour, face-match, or liveness claim', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textHi = update.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		expect(textHi).toBeDefined();
		for (const claim of FALSE_CLAIMS_HI) {
			expect(textHi).not.toMatch(claim);
		}
	});

	test('corrected texts state 90-day retention and deletion via privacy@rekrutai.co', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		const textHi = update.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		expect(textEn).toMatch(/90 days/);
		expect(textEn).toMatch(/privacy@rekrutai\.co/);
		expect(textHi).toMatch(/90 दिनों/);
		expect(textHi).toMatch(/privacy@rekrutai\.co/);
	});

	test('BLOCK 1: corrected texts contain no deletion completion-timeframe claim (EN + HI)', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		const textHi = update.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		for (const claim of COMPLETION_CLAIMS_EN) {
			expect(textEn).not.toMatch(claim);
		}
		for (const claim of COMPLETION_CLAIMS_HI) {
			expect(textHi).not.toMatch(claim);
		}
		// The deletion-on-request route itself must remain stated.
		expect(textEn).toMatch(/request deletion/i);
		expect(textHi).toMatch(/हटाने का अनुरोध/);
	});

	test('BLOCK 2: corrected EN text discloses the selfie, manual review, and no automated face-matching/liveness', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		expect(textEn).toMatch(/selfie/i);
		expect(textEn).toMatch(/reviewed manually/i);
		expect(textEn).toMatch(/no automated face-matching or liveness check is performed/i);
	});

	test('BLOCK 2: corrected HI text discloses the selfie with the same facts', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textHi = update.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		expect(textHi).toMatch(/सेल्फ़ी/);
		expect(textHi).toMatch(/मैन्युअल रूप से/);
		expect(textHi).toMatch(/कोई स्वचालित चेहरा-मिलान या जीवंतता जांच नहीं/);
	});

	test('BLOCK 2: corrected texts state BOTH the ID image and the selfie are retained 90 days', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		const textHi = update.params.find((p) => typeof p === 'string' && /हम क्या एकत्र करते हैं/.test(p));
		expect(textEn).toMatch(/ID image and selfie are retained for 90 days/i);
		expect(textHi).toMatch(/आईडी छवि और सेल्फ़ी/);
		expect(textHi).toMatch(/90 दिनों/);
	});

	test('corrected texts keep the DRAFT pending legal counsel review marking', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		expect(textEn).toMatch(/DRAFT — pending legal counsel review/);
	});
});
