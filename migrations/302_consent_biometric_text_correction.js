// =============================================================================
// Migration 302: biometric consent text correction — #1947 (S-D15 residuals,
// epic #1900). Lex-led panel (Lex + privacy + Rex), STOP 1 on #1947.
// =============================================================================
//
// Three false claims in the served consent texts are corrected:
//
//   Item 1 — `biometric` §1 (v1.0→v1.2 carried verbatim) told candidates the
//     collected measurements include "facial landmark positions … gaze
//     direction, blink rate, and head pose". Shipped measurement is
//     audio-only: lib/observerSpeech.js computes voice pitch range, speech
//     rate and pause patterns, in-process. No facial-landmark, gaze, blink
//     or head-pose extraction exists anywhere in shipped code, and the
//     biometric policy page already says so. The CONSENT side was the wrong
//     side; v1.3 §1 lists only the audio measurements and states the NOT
//     list explicitly.
//
//   Item 2 — `biometric` §2 and policy §3 described stored "face/voice
//     embeddings" with retention periods. Verified by full-tree search: no
//     INSERT INTO biometric_templates exists anywhere in this repo — the
//     migration-246 table is only counted/purged (euComplianceService,
//     legalHold). NO face or voice template is ever stored, so the panel
//     ruled DELETE, not narrow (narrowing to "face only" would keep a false
//     storage claim). v1.3 §2 states the no-storage truth; the diarization
//     carve-out is kept ("For clarity, …") so it is not orphaned.
//
//   Practice §1 — `biometric_practice` v1.1 (migration 273) carries the
//     same false §1 list. The shipped practice flow sends practice video to
//     an external AI provider, which returns coaching JUDGMENTS — the
//     fields normalizeVisionResult handles in lib/qp-ai.js / lib/polsia-ai.js
//     (eye_contact, facial_expressions, body_language,
//     professional_appearance). v1.2 §1 says exactly that, in Lex's
//     provider-judgment framing, and states Rekrut extracts no measurements
//     itself. Practice §2 is carried verbatim (its [RETENTION TERM PENDING
//     LEGAL REVIEW] bracket is a separate open item, not a #1947 claim).
//
// WHY AN INSERT, NOT AN UPDATE: migration 245 made consent_texts
// APPEND-ONLY (trigger trg_consent_texts_no_update). This migration INSERTs
// version '1.3' for `biometric` and '1.2' for `biometric_practice`,
// following migrations 272/273/297 exactly:
//   - Every current-version reader resolves by MAX(effective_from)
//     (lib/consentService.js), so the new rows become the served texts.
//   - consent_receipts pin the exact version consented to, so v1.2/v1.1
//     receipts stay untouched and read as STALE → re-consent by design.
//   - effective_from = NOW() wins MAX() because migrate.js runs each
//     migration in its own transaction sequentially.
//
// Copy truth only — this migration changes NO processing behaviour. The
// "DRAFT — pending legal counsel review" marking is kept. HI texts are
// faithful renderings of the corrected EN (the item-3 native/legal
// translation check on #1947 remains open and external).
//
// Safety: idempotent — INSERT … ON CONFLICT (consent_type, version)
// DO NOTHING makes a re-run a no-op.
// =============================================================================

const BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your audio — voice pitch range, speech rate, and pause patterns. We do NOT extract face measurements from your video, and gaze direction, blink rate, and head pose are not measured. We do NOT label emotions or infer emotional states. These are measurements, not judgments.

Speaker labels in your transcript: to label who said what in a recorded interview, we create a temporary mathematical template of each speaker's voice during processing; the template exists only while the labelling runs and is never stored. The template is made for one recording only and is never compared with any other recording. The speaker labels can be seen only by you and by the members of the hiring team who can already access your recording and transcript — labelling gives no one new access. The labels are used only to show who said what in the transcript; they are never used in any score, rating, or matching decision.

2. How long we keep it: We do not store biometric templates. No face or voice embedding is created or kept by our own systems, so there is no stored biometric template to delete. Per-turn behavioral measurements: Observer speech measurements are kept for up to 30 days from when they were recorded, under their own retention rule — they are not deleted with the video recording. Automated deletion at expiry is not yet enabled. For clarity, speaker labelling is different from the templates described above: its temporary voice template is never stored at all, so there is nothing to delete later — it is gone when the labelling ends. The speaker labels themselves stay with the transcript for as long as the recording is kept, under the rule in this section.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: You may decline biometric analysis and request a human-led interview instead. Declining will not affect your candidacy — a human recruiter will conduct the interview. Declining also means no speaker labelling: no speaker labels will be created for your interview, and your transcript will stay unlabelled.`;

const BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके ऑडियो से निकाले गए बायोमेट्रिक माप — आवाज़ की पिच रेंज, बोलने की गति और विराम पैटर्न। हम आपके वीडियो से चेहरे के माप नहीं निकालते, और दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति नहीं मापी जाती। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं।

आपके ट्रांसक्रिप्ट में वक्ता लेबल: किसी रिकॉर्ड किए गए साक्षात्कार में किसने क्या कहा, यह लेबल करने के लिए, हम प्रोसेसिंग के दौरान प्रत्येक वक्ता की आवाज़ का एक अस्थायी गणितीय टेम्पलेट बनाते हैं; टेम्पलेट केवल लेबलिंग चलने तक रहता है और इसे कभी संग्रहीत नहीं किया जाता। टेम्पलेट केवल एक रिकॉर्डिंग के लिए बनाया जाता है और इसकी तुलना कभी किसी अन्य रिकॉर्डिंग से नहीं की जाती। वक्ता लेबल केवल आप और भर्ती टीम के वे सदस्य देख सकते हैं जिनके पास पहले से ही आपकी रिकॉर्डिंग और ट्रांसक्रिप्ट तक पहुंच है — लेबलिंग से किसी को नई पहुंच नहीं मिलती। लेबल का उपयोग केवल यह दिखाने के लिए किया जाता है कि ट्रांसक्रिप्ट में किसने क्या कहा; इनका उपयोग कभी किसी स्कोर, रेटिंग या मिलान निर्णय में नहीं किया जाता।

2. हम इसे कितने समय तक रखते हैं: हम बायोमेट्रिक टेम्पलेट संग्रहीत नहीं करते। हमारी अपनी प्रणालियाँ कोई चेहरा या आवाज़ एम्बेडिंग नहीं बनातीं और न ही रखती हैं, इसलिए हटाने के लिए कोई संग्रहीत बायोमेट्रिक टेम्पलेट नहीं है। प्रति-टर्न व्यवहार माप: ऑब्ज़र्वर वाक् माप रिकॉर्ड किए जाने से 30 दिनों तक, अपने स्वयं के प्रतिधारण नियम के तहत रखे जाते हैं — वे वीडियो रिकॉर्डिंग के साथ नहीं हटाए जाते हैं। अवधि समाप्त होने पर स्वचालित हटाना अभी तक सक्षम नहीं है। स्पष्टता के लिए, वक्ता लेबलिंग ऊपर वर्णित टेम्पलेट से अलग है: इसका अस्थायी आवाज़ टेम्पलेट बिल्कुल संग्रहीत नहीं किया जाता, इसलिए बाद में हटाने के लिए कुछ नहीं रहता — लेबलिंग समाप्त होते ही वह समाप्त हो जाता है। वक्ता लेबल स्वयं ट्रांसक्रिप्ट के साथ उतने समय तक रहते हैं जितने समय तक रिकॉर्डिंग रखी जाती है, इस अनुभाग के नियम के तहत।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: आप बायोमेट्रिक विश्लेषण अस्वीकार कर सकते हैं और मानव-नेतृत्व वाले साक्षात्कार का अनुरोध कर सकते हैं। अस्वीकार करने से आपकी उम्मीदवारी प्रभावित नहीं होगी — एक मानव भर्तीकर्ता साक्षात्कार आयोजित करेगा। अस्वीकार करने का अर्थ यह भी है कि कोई वक्ता लेबलिंग नहीं होगी: आपके साक्षात्कार के लिए कोई वक्ता लेबल नहीं बनाए जाएंगे, और आपका ट्रांसक्रिप्ट बिना लेबल के रहेगा।`;

const QP_BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Your practice video and audio are reviewed by an external AI provider, which returns coaching judgments about eye contact, facial expressions, body language, and professional appearance, and about your spoken answers. These are the provider's judgments, not measurements we extract ourselves: we do not take facial landmark positions from your practice video, and we do not measure gaze direction, blink rate, or head pose. We do NOT label emotions or infer emotional states. These judgments are used only to give you coaching feedback on your practice response.

2. How long we keep it: Biometric templates and practice recordings are deleted 90 days after your practice session, unless you request earlier deletion. [RETENTION TERM PENDING LEGAL REVIEW — see S-066 M-2.]

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: Video analysis is optional. You may decline and practice with a text response instead — you will still receive full coaching feedback. Declining does not affect your account or access to practice features.`;

const QP_BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके अभ्यास वीडियो और ऑडियो की समीक्षा एक बाहरी AI प्रदाता करता है, जो आंखों के संपर्क, चेहरे के भाव, शारीरिक भाषा और पेशेवर उपस्थिति के बारे में, तथा आपके बोले गए उत्तरों के बारे में कोचिंग निर्णय लौटाता है। ये प्रदाता के निर्णय हैं, स्वयं हमारे द्वारा निकाले गए माप नहीं: हम आपके अभ्यास वीडियो से चेहरे के लैंडमार्क स्थान नहीं लेते, और हम दृष्टि दिशा, पलक झपकने की दर या सिर की स्थिति नहीं मापते। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। इन निर्णयों का उपयोग केवल आपके अभ्यास उत्तर पर कोचिंग फीडबैक देने के लिए किया जाता है।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट और अभ्यास रिकॉर्डिंग आपके अभ्यास सत्र के 90 दिनों बाद हटा दिए जाते हैं, जब तक आप पहले हटाने का अनुरोध न करें। [प्रतिधारण अवधि कानूनी समीक्षा लंबित — S-066 M-2 देखें।]

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: वीडियो विश्लेषण वैकल्पिक है। आप अस्वीकार कर सकते हैं और इसके बजाय टेक्स्ट उत्तर के साथ अभ्यास कर सकते हैं — आपको फिर भी पूर्ण कोचिंग फीडबैक मिलेगा। अस्वीकार करने से आपके खाते या अभ्यास सुविधाओं तक पहुंच प्रभावित नहीं होगी।`;

const ROWS = [
	['biometric', '1.3', BIOMETRIC_TEXT_EN, BIOMETRIC_TEXT_HI],
	['biometric_practice', '1.2', QP_BIOMETRIC_TEXT_EN, QP_BIOMETRIC_TEXT_HI],
];

module.exports = {
	name: '302_consent_biometric_text_correction',
	up: async (client) => {
		for (const [type, version, textEn, textHi] of ROWS) {
			await client.query(
				`INSERT INTO consent_texts (consent_type, version, text_en, text_hi, effective_from)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (consent_type, version) DO NOTHING`,
				[type, version, textEn, textHi],
			);
		}
		console.log('Migration 302: consent text corrected — biometric v1.3 + biometric_practice v1.2 (#1947)');
	},
	down: async (_client) => {
		// Intentional no-op. consent_texts is append-only (migration 245's
		// trigger forbids UPDATE/DELETE), so there is no lawful way to
		// "un-insert" v1.3/v1.2 — and reverting would restore the false
		// measurement list and stored-template claim this migration removes.
		// migrate.js never calls down(); one-way.
	},
};
