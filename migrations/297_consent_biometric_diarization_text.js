// =============================================================================
// Migration 297: biometric consent text v1.2 — speaker-labelling (diarization)
// disclosure (S-D15, #1917, epic #1900; Lex BR-6 / CF-4)
// =============================================================================
//
// Before this change, no consent text disclosed diarization: the pipeline
// (S-D01…S-D14) labels who spoke when in a recorded interview's transcript by
// creating a temporary voice-print template inside the diarization worker's
// child process. Lex's position (LEX-POSITION §2.2, BR-6): the disclosure
// must land BEFORE any enablement (S-D17), in the same change that corrects
// biometric-policy.tsx's "We do not extract … voice measurements" line —
// the #777 pattern (no published page may contradict shipped behaviour).
//
// Shape (CF-4): the disclosure is a clause WITHIN the existing `biometric`
// consent type, delivered by version bump — not a new consent type. Text is
// Lex's, drafted against BR-6/BR-7/BR-10/BR-14 (see the S-D15 build log for
// the drafts verbatim). V1.1 is carried verbatim except:
//   §1 + a "Speaker labels in your transcript" paragraph carrying the
//        canonical sentence: "to label who said what in a recorded interview,
//        we create a temporary mathematical template of each speaker's voice
//        during processing; the template exists only while the labelling
//        runs and is never stored" + who sees the labels + BR-12 fence.
//   §2 + a carve-out: the labelling template is never stored at all (v1.1's
//        stored-template sentence must not be read to cover it); labels stay
//        with the transcript under the recording's retention clock (BR-14).
//   Your rights + decline also means no speaker labelling.
//
// WHY AN INSERT, NOT AN UPDATE: migration 245 made consent_texts APPEND-ONLY
// (trigger trg_consent_texts_no_update). This migration INSERTs version
// '1.2' for `biometric` only, following migrations 272/273 exactly:
//   - Every current-version reader resolves by MAX(effective_from)
//     (lib/consentService.js), so v1.2 becomes the served text automatically.
//   - consent_receipts pin the exact version consented to, so v1.1 receipts
//     stay untouched and read as STALE → CONSENT_VERSION_STALE re-consent.
//   - effective_from = NOW() wins MAX() because migrate.js runs each
//     migration in its own transaction sequentially.
//
// Copy truth only — this migration changes NO processing behaviour. The
// "DRAFT — pending legal counsel review" marking is kept. HI is Lex's
// rendering of the same text (native/legal translation check tracked as a
// follow-up — consent receipts pin the HI text actually seen).
//
// Safety: idempotent — INSERT … ON CONFLICT (consent_type, version)
// DO NOTHING makes a re-run a no-op.
// =============================================================================

const NEW_VERSION = '1.2';

const BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your video and audio — facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose. We do NOT label emotions or infer emotional states. These are measurements, not judgments.

Speaker labels in your transcript: to label who said what in a recorded interview, we create a temporary mathematical template of each speaker's voice during processing; the template exists only while the labelling runs and is never stored. The template is made for one recording only and is never compared with any other recording. The speaker labels can be seen only by you and by the members of the hiring team who can already access your recording and transcript — labelling gives no one new access. The labels are used only to show who said what in the transcript; they are never used in any score, rating, or matching decision.

2. How long we keep it: Biometric templates (face/voice embeddings) are deleted when the associated recording is deleted (90 days after the hiring decision). Per-turn behavioral measurements: Observer speech measurements are kept for up to 30 days from when they were recorded, under their own retention rule — they are not deleted with the video recording. Automated deletion at expiry is not yet enabled. Speaker labelling is different from the templates described above: its temporary voice template is never stored at all, so there is nothing to delete later — it is gone when the labelling ends. The speaker labels themselves stay with the transcript for as long as the recording is kept, under the rule in this section.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: You may decline biometric analysis and request a human-led interview instead. Declining will not affect your candidacy — a human recruiter will conduct the interview. Declining also means no speaker labelling: no speaker labels will be created for your interview, and your transcript will stay unlabelled.`;

const BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके वीडियो और ऑडियो से निकाले गए बायोमेट्रिक माप — चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं।

आपके ट्रांसक्रिप्ट में वक्ता लेबल: किसी रिकॉर्ड किए गए साक्षात्कार में किसने क्या कहा, यह लेबल करने के लिए, हम प्रोसेसिंग के दौरान प्रत्येक वक्ता की आवाज़ का एक अस्थायी गणितीय टेम्पलेट बनाते हैं; टेम्पलेट केवल लेबलिंग चलने तक रहता है और इसे कभी संग्रहीत नहीं किया जाता। टेम्पलेट केवल एक रिकॉर्डिंग के लिए बनाया जाता है और इसकी तुलना कभी किसी अन्य रिकॉर्डिंग से नहीं की जाती। वक्ता लेबल केवल आप और भर्ती टीम के वे सदस्य देख सकते हैं जिनके पास पहले से ही आपकी रिकॉर्डिंग और ट्रांसक्रिप्ट तक पहुंच है — लेबलिंग से किसी को नई पहुंच नहीं मिलती। लेबल का उपयोग केवल यह दिखाने के लिए किया जाता है कि ट्रांसक्रिप्ट में किसने क्या कहा; इनका उपयोग कभी किसी स्कोर, रेटिंग या मिलान निर्णय में नहीं किया जाता।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट (चेहरा/आवाज़ एम्बेडिंग) संबंधित रिकॉर्डिंग हटने पर हटा दिए जाते हैं (भर्ती निर्णय के 90 दिन बाद)। प्रति-टर्न व्यवहार माप: ऑब्ज़र्वर वाक् माप रिकॉर्ड किए जाने से 30 दिनों तक, अपने स्वयं के प्रतिधारण नियम के तहत रखे जाते हैं — वे वीडियो रिकॉर्डिंग के साथ नहीं हटाए जाते हैं। अवधि समाप्त होने पर स्वचालित हटाना अभी तक सक्षम नहीं है। वक्ता लेबलिंग ऊपर वर्णित टेम्पलेट से अलग है: इसका अस्थायी आवाज़ टेम्पलेट बिल्कुल संग्रहीत नहीं किया जाता, इसलिए बाद में हटाने के लिए कुछ नहीं रहता — लेबलिंग समाप्त होते ही वह समाप्त हो जाता है। वक्ता लेबल स्वयं ट्रांसक्रिप्ट के साथ उतने समय तक रहते हैं जितने समय तक रिकॉर्डिंग रखी जाती है, इस अनुभाग के नियम के तहत।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: आप बायोमेट्रिक विश्लेषण अस्वीकार कर सकते हैं और मानव-नेतृत्व वाले साक्षात्कार का अनुरोध कर सकते हैं। अस्वीकार करने से आपकी उम्मीदवारी प्रभावित नहीं होगी — एक मानव भर्तीकर्ता साक्षात्कार आयोजित करेगा। अस्वीकार करने का अर्थ यह भी है कि कोई वक्ता लेबलिंग नहीं होगी: आपके साक्षात्कार के लिए कोई वक्ता लेबल नहीं बनाए जाएंगे, और आपका ट्रांसक्रिप्ट बिना लेबल के रहेगा।`;

module.exports = {
	name: '297_consent_biometric_diarization_text',
	up: async (client) => {
		await client.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi, effective_from)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (consent_type, version) DO NOTHING`,
			['biometric', NEW_VERSION, BIOMETRIC_TEXT_EN, BIOMETRIC_TEXT_HI],
		);
		console.log('Migration 297: consent text v1.2 inserted for biometric — diarization disclosure (S-D15 #1917, BR-6)');
	},
	down: async (_client) => {
		// Intentional no-op. consent_texts is append-only (migration 245's
		// trigger forbids UPDATE/DELETE), so there is no lawful way to
		// "un-insert" v1.2 — and reverting would restore the non-disclosure
		// this migration fixes. migrate.js never calls down(); one-way.
	},
};
