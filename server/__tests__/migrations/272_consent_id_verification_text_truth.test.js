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
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '272_consent_id_verification_text_truth.js');
const PAGE_PATH = path.join(ROOT, 'client', 'src', 'pages', 'consent-screens.tsx');

const FALSE_CLAIMS_EN = [/24 hours/i, /24-hour/i, /liveness/i, /face match/i, /facial capture/i, /auto-delete/i, /auto delete/i];
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

	test('corrected texts keep the DRAFT pending legal counsel review marking', () => {
		const update = calls.find((c) => /UPDATE consent_texts/i.test(c.sql));
		const textEn = update.params.find((p) => typeof p === 'string' && /What we collect/i.test(p));
		expect(textEn).toMatch(/DRAFT — pending legal counsel review/);
	});
});
