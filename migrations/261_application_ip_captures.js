// =============================================================================
// Migration 261: application_ip_captures (#815, S-095)
// =============================================================================
//
// Application-time IP capture store: ONE row per job application,
// written only at MANUAL application time, only with the candidate's
// explicit consent, and only while the #807 dark chassis flag is ON
// (the pipeline is lib/applicationIpCapture.js; the flag's sole
// reader is lib/threatIntelFlag.js). Nothing reads this table in
// this story — no route, no read API, no recruiter- or
// candidate-facing surface (#788 quarantine: captures recorded
// before the #788 determination are never surfaced; if counsel's
// answer is no, the disposition is purge, never migrate).
//
// What a row holds:
//   - ip_fingerprint: company-siloed HMAC-SHA256 hex of the
//     normalised request IP (see lib/threatIntelChecks.js header for
//     the honest limits: this is pseudonymisation — the value
//     remains personal data, and a low-entropy subject like an IPv4
//     address can be reversed by recomputation by any holder of the
//     fingerprint secret). The format CHECK makes a raw IP in this
//     column impossible at the DB layer. There is NO raw-IP column
//     anywhere in this table, and the raw IP is never persisted.
//   - Consent provenance: consent_text_version (resolved server-side
//     from consent_texts at capture time), consent_granted_at, and a
//     receipt_hash binding candidate + application + grant instant.
//   - Retention: retention_expires_at is stamped at insert as
//     captured_at + 12 months (the counsel-confirm period; counsel
//     confirms before the flag is ever enabled in production).
//
// Column notes:
//   - job_application_id: UNIQUE (one capture per application; the
//     pipeline's INSERT is ON CONFLICT DO NOTHING) with an FK
//     carrying NO cascade action, deliberately — the parent
//     job_applications row is retained as a skeleton (#780), so a
//     cascade could never fire, and an uncounted cascade would be
//     an unprovable erasure. Erasure is the explicit, counted
//     DELETE in erasePersonalData() (lib/erasureService.js, #807
//     position, keyed by the #780 UNHELD application set; held
//     applications' rows survive and are counted).
//   - company_id: NOT NULL — denormalised from the job row at
//     capture time (never caller-asserted from the request body);
//     it scopes the row and keys the fingerprint silo. The capture
//     pipeline REFUSES an unsiloed subject (no company → no mint),
//     and the named CHECK below encodes the same invariant in the
//     schema (migration-260 pattern, database gate F1 on PR #1211):
//     a non-NULL fingerprint requires a company.
//   - consent_texts seed: 'application_ip' version '1' (EN + HI),
//     plain-language notice per the STOP 1 specialists (what is
//     captured — a pseudonymised fingerprint from the IP address;
//     purpose — duplicate/fraud detection for this employer only;
//     retention — 12 months; withdrawal route; declining changes
//     nothing about the application). The consent_type CHECKs on
//     BOTH consent_texts and consent_receipts are widened to admit
//     the new type (migration 250 / 257 pattern).
//
// Idempotent (IF NOT EXISTS / drop-constraint-if-exists /
// ON CONFLICT DO NOTHING throughout) and run inside migrate.js's
// per-migration transaction, per house pattern.
// =============================================================================

const APPLICATION_IP_TEXT_EN = `When you apply for a job, Rekrut AI can record a security fingerprint made from your IP address — but only if you agree.

1. What we record: A pseudonymised fingerprint created from your IP address using a one-way security function. We never store your actual IP address. The fingerprint can only be compared within the single employer you are applying to — it cannot be used to follow you across different employers. The fingerprint stays linked to your application.

2. Why: To help this employer detect duplicate or fraudulent applications for their jobs. It is used for security only. It is never used to judge your skills or your suitability for the job.

3. How long we keep it: 12 months from when you apply, then it is deleted. It is also deleted if you ask us to erase your data, unless the law requires us to keep it for longer (for example, during a legal hold).

4. How to withdraw: Email privacy@rekrutai.co at any time to withdraw this consent and have the fingerprint deleted.

Your choice: This is optional. If you decline, nothing changes — your application is submitted and considered in exactly the same way.`;

const APPLICATION_IP_TEXT_HI = `जब आप किसी नौकरी के लिए आवेदन करते हैं, तो Rekrut AI आपके IP पते से बना एक सुरक्षा फिंगरप्रिंट रिकॉर्ड कर सकता है — लेकिन केवल तभी जब आप सहमत हों।

1. हम क्या रिकॉर्ड करते हैं: आपके IP पते से एक तरफ़ा सुरक्षा फ़ंक्शन द्वारा बनाया गया छद्मनामित (pseudonymised) फिंगरप्रिंट। हम आपका वास्तविक IP पता कभी संग्रहीत नहीं करते। इस फिंगरप्रिंट की तुलना केवल उसी एक नियोक्ता के भीतर की जा सकती है जिसके पास आप आवेदन कर रहे हैं — इसका उपयोग विभिन्न नियोक्ताओं में आपका पीछा करने के लिए नहीं किया जा सकता। फिंगरप्रिंट आपके आवेदन से जुड़ा रहता है।

2. क्यों: इस नियोक्ता को उनकी नौकरियों के लिए डुप्लिकेट या धोखाधड़ी वाले आवेदनों का पता लगाने में मदद करने के लिए। इसका उपयोग केवल सुरक्षा के लिए किया जाता है। इसका उपयोग आपके कौशल या नौकरी के लिए आपकी उपयुक्तता का आकलन करने के लिए कभी नहीं किया जाता।

3. हम इसे कितने समय तक रखते हैं: आपके आवेदन करने के 12 महीने तक, उसके बाद यह हटा दिया जाता है। यदि आप हमसे अपना डेटा मिटाने के लिए कहते हैं तो यह भी हटा दिया जाता है, जब तक कि कानून हमें इसे अधिक समय तक रखने के लिए बाध्य न करे (उदाहरण के लिए, कानूनी होल्ड के दौरान)।

4. सहमति कैसे वापस लें: इस सहमति को वापस लेने और फिंगरप्रिंट हटवाने के लिए किसी भी समय privacy@rekrutai.co पर ईमेल करें।

आपकी पसंद: यह वैकल्पिक है। यदि आप अस्वीकार करते हैं, तो कुछ नहीं बदलता — आपका आवेदन ठीक उसी तरह जमा और विचार किया जाता है।`;

module.exports = {
	name: '261_application_ip_captures',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS application_ip_captures (
				id                 BIGSERIAL PRIMARY KEY,
				job_application_id BIGINT NOT NULL UNIQUE REFERENCES job_applications(id),
				candidate_id       BIGINT NOT NULL,
				company_id         BIGINT NOT NULL,
				ip_fingerprint     TEXT NOT NULL CHECK (ip_fingerprint ~ '^[0-9a-f]{64}$'),
				consent_text_version INT NOT NULL,
				consent_granted_at TIMESTAMPTZ NOT NULL,
				receipt_hash       TEXT NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
				captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
				retention_expires_at TIMESTAMPTZ NOT NULL,
				CONSTRAINT application_ip_captures_siloed_fingerprint CHECK (ip_fingerprint IS NULL OR company_id IS NOT NULL)
			);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_application_ip_captures_company_fingerprint
			ON application_ip_captures(company_id, ip_fingerprint);
		`);

		// Widen the consent_type CHECKs on BOTH consent tables to admit
		// 'application_ip' (migration 250 / 257 pattern: drop the named
		// constraint if it exists, re-add with the widened list).
		await client.query(`
			ALTER TABLE consent_texts DROP CONSTRAINT IF EXISTS consent_texts_consent_type_check;
		`);
		await client.query(`
			ALTER TABLE consent_texts
			ADD CONSTRAINT consent_texts_consent_type_check
			CHECK (consent_type IN ('recording','biometric','id_verification','biometric_practice','observer_capture','application_ip'));
		`);
		await client.query(`
			ALTER TABLE consent_receipts DROP CONSTRAINT IF EXISTS consent_receipts_consent_type_check;
		`);
		await client.query(`
			ALTER TABLE consent_receipts
			ADD CONSTRAINT consent_receipts_consent_type_check
			CHECK (consent_type IN ('recording','biometric','id_verification','biometric_practice','observer_capture','application_ip'));
		`);

		// Seed the v1 consent text (idempotent).
		await client.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi)
			 VALUES ('application_ip', '1', $1, $2)
			 ON CONFLICT (consent_type, version) DO NOTHING`,
			[APPLICATION_IP_TEXT_EN, APPLICATION_IP_TEXT_HI],
		);

		console.log('Migration 261: application_ip_captures created + application_ip consent text seeded (#815)');
	},

	async down(client) {
		await client.query(`DROP TABLE IF EXISTS application_ip_captures`);
		// The seeded consent_texts row is NOT deleted here: consent_texts
		// is append-only (migration 245 trigger blocks DELETE), and the
		// row is reference data that existing consent provenance may
		// cite. The widened consent_type CHECKs are likewise left in
		// place (migration 250 / 257 precedent — narrowing would fail
		// if rows of the new type remained, and the widened list is
		// harmless without the capture table).
	},
};
