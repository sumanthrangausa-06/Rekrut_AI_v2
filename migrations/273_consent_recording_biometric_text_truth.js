// =============================================================================
// Migration 273: correct the seeded recording + biometric + biometric_practice
// consent texts (issues #1563 + #1564, combined lane)
// =============================================================================
//
// Migration 244 seeded consent_texts with two false claims (EN + HI), and
// migration 250 carried one of them into 'biometric_practice':
//
//   #1563 — 'biometric' v1.0 §2: "Per-turn behavioral measurements are
//     deleted with the video recording." FALSE. Observer speech measurements
//     purge on their OWN 30-day rule: EuComplianceService.
//     purgeExpiredSpeechMeasurements (services/euComplianceService.js) reads
//     the 'observer_audio' data_retention_policies row = 30 days
//     (migration 257), cuts off on the measurements' own created_at, and
//     runs under the RETENTION_PURGE_LIVE dry-run-default gate — automated
//     deletion at expiry is not yet enabled. The #1562-merged policy page
//     (client/src/pages/biometric-policy.tsx) already states this truthfully.
//
//   #1564 — "Deletion is completed within 30 days" (EN) /
//     "30 दिनों के भीतर हटाना पूर्ण किया जाता है" (HI) in 'recording' §3,
//     'biometric' §3, and 'biometric_practice' §3. Reviewer BLOCK on PR
//     #1560 (comment 6320517942): no code implements a 30-day deletion
//     COMPLETION SLA — deletion-on-request is a manual email route. The only
//     supported timeframe is the #1556-merged respond window ("We respond
//     to deletion requests within 30 days (GDPR) or 45 days (CCPA)" —
//     respond ≠ completed).
//
// 244 and 250 are already applied and are NOT edited in place.
//
// WHY AN INSERT, NOT AN UPDATE (Quinn HL-003 FAIL on PR #1560, comment
// 6321198091): migration 245 made consent_texts APPEND-ONLY — trigger
// trg_consent_texts_no_update (prevent_consent_text_mutation) rejects every
// UPDATE/DELETE with "INSERT a new version instead." This migration INSERTs
// new version '1.1' rows for all three affected types.
//
// That is safe because NO reader pins a version:
//   - Every current-version reader resolves by MAX(effective_from):
//     lib/consentService.js getConsentText / getCurrentTextVersion /
//     recordConsent, GET /api/consent/texts/:type (server/routes/consent.js).
//     The v1.1 rows therefore become the served text automatically.
//   - consent_receipts pin the EXACT text a candidate saw via the FK
//     (consent_type, consent_text_version), so existing receipts stay
//     pinned to v1.0 untouched, and read as STALE under the designed
//     re-consent behaviour.
//
// effective_from = NOW() wins MAX(effective_from): migrate.js runs each
// migration in its OWN transaction sequentially, so 273's transaction
// timestamp is strictly later than any earlier seed.
//
// Copy truth only — this migration changes NO retention/purge behaviour.
// All out-of-scope sentences are carried verbatim from the v1.0 seeds, and
// the "DRAFT — pending legal counsel review" marking is kept.
//
// Safety: idempotent — INSERT … ON CONFLICT (consent_type, version)
// DO NOTHING (the consent_texts PK) makes a re-run a no-op.
// =============================================================================

const NEW_VERSION = '1.1';

const RECORDING_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Video and audio recordings of your interview session, including your face, voice, and screen-shared content (if any).

2. How long we keep it: Recordings are deleted 90 days after the hiring decision is finalized, unless you request earlier deletion.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Note: If you decline recording consent, the interview session cannot start. Recording is required to conduct the interview.`;

const RECORDING_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके साक्षात्कार सत्र की वीडियो और ऑडियो रिकॉर्डिंग, जिसमें आपका चेहरा, आवाज़ और साझा की गई स्क्रीन सामग्री (यदि कोई हो) शामिल है।

2. हम इसे कितने समय तक रखते हैं: भर्ती निर्णय अंतिम होने के 90 दिनों के बाद रिकॉर्डिंग हटा दी जाती है, जब तक आप पहले हटाने का अनुरोध न करें।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

नोट: यदि आप रिकॉर्डिंग सहमति अस्वीकार करते हैं, तो साक्षात्कार सत्र शुरू नहीं हो सकता। साक्षात्कार आयोजित करने के लिए रिकॉर्डिंग आवश्यक है।`;

const BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your video and audio — facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose. We do NOT label emotions or infer emotional states. These are measurements, not judgments.

2. How long we keep it: Biometric templates (face/voice embeddings) are deleted when the associated recording is deleted (90 days after the hiring decision). Per-turn behavioral measurements: Observer speech measurements are kept for up to 30 days from when they were recorded, under their own retention rule — they are not deleted with the video recording. Automated deletion at expiry is not yet enabled.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: You may decline biometric analysis and request a human-led interview instead. Declining will not affect your candidacy — a human recruiter will conduct the interview.`;

const BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके वीडियो और ऑडियो से निकाले गए बायोमेट्रिक माप — चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट (चेहरा/आवाज़ एम्बेडिंग) संबंधित रिकॉर्डिंग हटने पर हटा दिए जाते हैं (भर्ती निर्णय के 90 दिन बाद)। प्रति-टर्न व्यवहार माप: ऑब्ज़र्वर वाक् माप रिकॉर्ड किए जाने से 30 दिनों तक, अपने स्वयं के प्रतिधारण नियम के तहत रखे जाते हैं — वे वीडियो रिकॉर्डिंग के साथ नहीं हटाए जाते हैं। अवधि समाप्त होने पर स्वचालित हटाना अभी तक सक्षम नहीं है।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: आप बायोमेट्रिक विश्लेषण अस्वीकार कर सकते हैं और मानव-नेतृत्व वाले साक्षात्कार का अनुरोध कर सकते हैं। अस्वीकार करने से आपकी उम्मीदवारी प्रभावित नहीं होगी — एक मानव भर्तीकर्ता साक्षात्कार आयोजित करेगा।`;

const QP_BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your practice video and audio — facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose. We do NOT label emotions or infer emotional states. These are measurements, not judgments. They are used only to give you coaching feedback on your practice response.

2. How long we keep it: Biometric templates and practice recordings are deleted 90 days after your practice session, unless you request earlier deletion. [RETENTION TERM PENDING LEGAL REVIEW — see S-066 M-2.]

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: Video analysis is optional. You may decline and practice with a text response instead — you will still receive full coaching feedback. Declining does not affect your account or access to practice features.`;

const QP_BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके अभ्यास वीडियो और ऑडियो से निकाले गए बायोमेट्रिक माप — चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं। इनका उपयोग केवल आपके अभ्यास उत्तर पर कोचिंग फीडबैक देने के लिए किया जाता है।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट और अभ्यास रिकॉर्डिंग आपके अभ्यास सत्र के 90 दिनों बाद हटा दिए जाते हैं, जब तक आप पहले हटाने का अनुरोध न करें। [प्रतिधारण अवधि कानूनी समीक्षा लंबित — S-066 M-2 देखें।]

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: वीडियो विश्लेषण वैकल्पिक है। आप अस्वीकार कर सकते हैं और इसके बजाय टेक्स्ट उत्तर के साथ अभ्यास कर सकते हैं — आपको फिर भी पूर्ण कोचिंग फीडबैक मिलेगा। अस्वीकार करने से आपके खाते या अभ्यास सुविधाओं तक पहुंच प्रभावित नहीं होगी।`;

const ROWS = [
	['recording', RECORDING_TEXT_EN, RECORDING_TEXT_HI],
	['biometric', BIOMETRIC_TEXT_EN, BIOMETRIC_TEXT_HI],
	['biometric_practice', QP_BIOMETRIC_TEXT_EN, QP_BIOMETRIC_TEXT_HI],
];

module.exports = {
	name: '273_consent_recording_biometric_text_truth',
	up: async (client) => {
		for (const [type, textEn, textHi] of ROWS) {
			await client.query(
				`INSERT INTO consent_texts (consent_type, version, text_en, text_hi, effective_from)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (consent_type, version) DO NOTHING`,
				[type, NEW_VERSION, textEn, textHi],
			);
		}
		console.log('Migration 273: consent text v1.1 inserted for recording, biometric, biometric_practice (#1563 + #1564)');
	},
	down: async (_client) => {
		// Intentional no-op. consent_texts is append-only (migration 245's
		// trigger forbids UPDATE/DELETE), so there is no lawful way to
		// "un-insert" v1.1 or restore v1.0 as current — and reverting would
		// restore the false per-turn linkage and completion-SLA claims this
		// migration removes. migrate.js never calls down(); one-way.
	},
};
