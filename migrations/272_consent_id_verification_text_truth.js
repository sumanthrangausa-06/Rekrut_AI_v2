// =============================================================================
// Migration 272: correct the id_verification consent text seeded by 244 (#1559)
// =============================================================================
//
// Migration 244 seeded consent_texts (type='id_verification', version='1.0')
// with two false claims, in EN and HI:
//   - "ID images are deleted within 24 hours of identity verification" /
//     "ID images auto-delete within 24 hours" — FALSE. Verification retention
//     is 90 days (lib/verification-config.js DEFAULT_RETENTION_DAYS = 90;
//     verification_requests.expires_at = NOW() + 90 days) and no automated
//     deletion job for verification_requests exists.
//   - "a live facial capture used to match the ID photo (liveness check)" —
//     FALSE. No face-match or liveness implementation exists for ID
//     verification (same unverified class removed from the biometric policy
//     page by #1555 / PR #1556).
//
// 244 is already applied and applied migrations are not re-run (cf. 269,
// which exists to repair DBs that already ran the original 268), so 244 is
// NOT edited in place.
//
// WHY AN INSERT, NOT AN UPDATE (Quinn HL-003 FAIL on PR #1560, comment
// 6321198091): migration 245 made consent_texts APPEND-ONLY — trigger
// trg_consent_texts_no_update (prevent_consent_text_mutation) rejects every
// UPDATE/DELETE with "INSERT a new version instead." The first version of
// this migration UPDATE-d the v1.0 row, so a real `node migrate.js` run
// crashed at 272 on every database that has run 245 (fresh installs AND
// staging/prod). The mocked-client unit test never saw the trigger — the
// #1306 failure class. This revision follows the 245 design instead:
//
//   INSERT a new version '1.1' carrying the corrected text.
//
// That is safe because NO reader pins version '1.0':
//   - Every current-version reader resolves by MAX(effective_from):
//     lib/consentService.js (recordConsent / getCurrentTextVersion /
//     getText), lib/applicationIpCapture.js, lib/observerCaptureGate.js.
//     The v1.1 row therefore becomes the served text automatically.
//   - consent_receipts pin the EXACT text a candidate saw via the FK
//     (consent_type, consent_text_version) → consent_texts(consent_type,
//     version), so existing receipts stay pinned to v1.0 untouched.
//   - A receipt at v1.0 against a current v1.1 reads as STALE in
//     consentService (verifyConsent / getConsentState) — the designed
//     ?reason=stale re-consent behaviour: text changed → re-consent.
//
// effective_from = NOW() wins the MAX(effective_from) resolution because
// migrate.js runs each migration in its OWN transaction sequentially
// (BEGIN … COMMIT per migration), so 272's transaction timestamp is
// strictly later than the timestamp 244's seed INSERT took on a fresh
// install — and on any already-migrated database it is later still.
//
// Copy truth only — this migration changes NO retention/purge behaviour.
// The corrected text keeps the "DRAFT — pending legal counsel review"
// marking the 244 seed carries.
//
// Review BLOCK corrections (PR #1560, comment 6320517942; text re-approved
// in the scoped re-review, comment 6320982954 — the texts below are those
// approved strings, unchanged):
//   1. NO deletion timeframe of any kind. An earlier draft of this text
//      said "Deletion is completed within 30 days" — unsupported: no code
//      implements a completion SLA; deletion-on-request is a manual email
//      route. biometric-policy.tsx (#1556) supports only RESPONDING to
//      deletion requests within 30 days (GDPR) / 45 days (CCPA), and
//      respond ≠ completed. Per the STOP 1 Lex premise (no timeframe the
//      system does not perform), §3 states the route and no deadline.
//   2. SELFIE DISCLOSED. routes/verification.js REQUIRES both id_document
//      and selfie (400 if the selfie is missing) and stores
//      selfie_encrypted_url in the same verification_requests row under
//      the same 90-day expires_at. Review is manual only (admin
//      approve/reject); FACE_MATCH in lib/verification-config.js is only
//      a status label — no automated face-matching or liveness exists.
//      §1 therefore discloses BOTH items, their manual review, and the
//      absence of automated face-matching/liveness; §2 retains both for
//      90 days. EN + HI state the same facts.
//
// Safety: idempotent — INSERT … ON CONFLICT (consent_type, version)
// DO NOTHING (the consent_texts PK) makes a re-run a no-op.
// =============================================================================

const ID_VERIFICATION_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: An image of your government-issued ID and a selfie, collected to verify your identity. Both are reviewed manually by the hiring team; no automated face-matching or liveness check is performed.

2. How long we keep it: Your ID image and selfie are retained for 90 days from identity verification, under the verification retention schedule. The verification result (pass/fail + timestamp) is retained per the data retention schedule.

3. How to delete: To request deletion of your ID image, selfie, or the verification result record, email privacy@rekrutai.co.`;

const ID_VERIFICATION_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपकी पहचान सत्यापित करने के लिए एकत्र की गई आपके सरकारी पहचान पत्र की छवि और एक सेल्फ़ी। दोनों की समीक्षा भर्ती टीम द्वारा मैन्युअल रूप से की जाती है; कोई स्वचालित चेहरा-मिलान या जीवंतता जांच नहीं की जाती है।

2. हम इसे कितने समय तक रखते हैं: आपकी आईडी छवि और सेल्फ़ी पहचान सत्यापन से 90 दिनों तक सत्यापन प्रतिधारण अनुसूची के अनुसार रखी जाती हैं। सत्यापन परिणाम (पास/फेल + टाइमस्टैम्प) डेटा प्रतिधारण अनुसूची के अनुसार रखा जाता है।

3. कैसे हटाएं: अपनी आईडी छवि, सेल्फ़ी या सत्यापन परिणाम रिकॉर्ड को हटाने का अनुरोध करने के लिए privacy@rekrutai.co पर ईमेल करें।`;

module.exports = {
	name: '272_consent_id_verification_text_truth',
	up: async (client) => {
		await client.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi, effective_from)
			 VALUES ($1, $2, $3, $4, NOW())
			 ON CONFLICT (consent_type, version) DO NOTHING`,
			['id_verification', '1.1', ID_VERIFICATION_TEXT_EN, ID_VERIFICATION_TEXT_HI],
		);
		console.log('Migration 272: id_verification consent text v1.1 inserted (#1559)');
	},
	down: async (_client) => {
		// Intentional no-op. consent_texts is append-only (migration 245's
		// trigger forbids UPDATE/DELETE), so there is no lawful way to
		// "un-insert" v1.1 or restore v1.0 as current — and reverting would
		// in any case restore the false 24-hour / liveness claims this
		// migration removes. migrate.js never calls down(); the correction
		// is intentionally one-way.
	},
};
