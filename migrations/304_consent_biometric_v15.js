// =============================================================================
// Migration 304: biometric consent text v1.5 — §2 'created' correction
// (#2050; Lex ruling on #2028, comment 6545649899)
// =============================================================================
//
// Lex ruled that biometric v1.4 (migration 303) §2 contradicted §1: §2's
// embedding sentence said "No face or voice embedding is created or kept
// by our own systems" — but speaker labelling DOES create a temporary
// voice template in memory (never stored; the diarization engine computes
// voice-print embeddings in-process, dying at exit), and §1 says so. §2's
// later clarifier spoke only to storage and never retracted "created".
// Precedent: PR #2030's review blocked the policy page §4 for the
// identical formulation and §4 was rewritten.
//
// v1.5 replaces ONLY that §2 embedding sentence with Lex's exact
// sentence (EN verbatim):
//
//   "No face embedding is created, and no face or voice embedding is kept
//   or stored by our own systems, so there is no stored biometric
//   template to delete."
//
// The lead-in "We do not store biometric templates." is unchanged, the
// rest of §2 is unchanged, and the rest of the text is v1.4 (migration
// 303) carried VERBATIM — the constants below were generated from the
// 303 constants by replacing that one sentence, and the 304 pin test
// proves byte-identity everywhere else (EN and HI). The HI text is a
// faithful rendering of the same one-sentence change only (the external
// native/legal Hindi translation check already open on #1947 is NOT
// closed by this migration).
//
// WHY AN INSERT, NOT AN UPDATE: migration 245 made consent_texts
// APPEND-ONLY (trigger trg_consent_texts_no_update). This migration
// INSERTs version '1.5' for `biometric` only, following migrations
// 297/302/303 exactly:
//   - Every current-version reader resolves by MAX(effective_from)
//     (lib/consentService.js), so v1.5 becomes the served text.
//   - consent_receipts pin the exact version consented to, so v1.4
//     receipts stay untouched and read as STALE → re-consent by design.
//   - effective_from = NOW() wins MAX() because migrate.js runs each
//     migration in its own transaction sequentially.
//
// Copy truth only — this migration changes NO processing behaviour.
// DIARIZATION_ENABLED stays OFF; #1919 switch-on remains gated on this
// landing (plus #1918 and the #1837 hosting decision). The
// "DRAFT — pending legal counsel review" marking is kept.
//
// Safety: idempotent — INSERT … ON CONFLICT (consent_type, version)
// DO NOTHING makes a re-run a no-op.
// =============================================================================

const BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your audio — voice pitch range, speech rate, and pause patterns. We do NOT extract face measurements from your video, and gaze direction, blink rate, and head pose are not measured. We do NOT label emotions or infer emotional states. These are measurements, not judgments. When you answer by voice, your audio is sent to an external speech-to-text provider to be turned into a transcript. The provider returns the transcript only; your audio is not used to identify you, and no voice template is created or stored from it.

Speaker labels in your transcript: to label who said what in a recorded interview, we create a temporary mathematical template of each speaker's voice during processing; the template exists only while the labelling runs and is never stored. The template is made for one recording only and is never compared with any other recording. The speaker labels can be seen only by you and by the members of the hiring team who can already access your recording and transcript — labelling gives no one new access. The labels are used only to show who said what in the transcript; they are never used in any score, rating, or matching decision.

2. How long we keep it: We do not store biometric templates. No face embedding is created, and no face or voice embedding is kept or stored by our own systems, so there is no stored biometric template to delete. Per-turn behavioral measurements: Observer speech measurements are kept for up to 30 days from when they were recorded, under their own retention rule — they are not deleted with the video recording. Automated deletion at expiry is not yet enabled. For clarity, speaker labelling is different from the templates described above: its temporary voice template is never stored at all, so there is nothing to delete later — it is gone when the labelling ends. The speaker labels themselves stay with the transcript for as long as the recording is kept, under the rule in this section.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. We respond to deletion requests within 30 days (GDPR) or 45 days (CCPA).

Your rights: You may decline biometric analysis and request a human-led interview instead. Declining will not affect your candidacy — a human recruiter will conduct the interview. Declining also means no speaker labelling: no speaker labels will be created for your interview, and your transcript will stay unlabelled.`;

const BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके ऑडियो से निकाले गए बायोमेट्रिक माप — आवाज़ की पिच रेंज, बोलने की गति और विराम पैटर्न। हम आपके वीडियो से चेहरे के माप नहीं निकालते, और दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति नहीं मापी जाती। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं। जब आप आवाज़ से उत्तर देते हैं, तो आपका ऑडियो एक बाहरी स्पीच-टू-टेक्स्ट प्रदाता को भेजा जाता है ताकि उसे ट्रांसक्रिप्ट में बदला जा सके। प्रदाता केवल ट्रांसक्रिप्ट लौटाता है; आपके ऑडियो का उपयोग आपकी पहचान करने के लिए नहीं किया जाता, और उससे कोई वॉइस टेम्पलेट नहीं बनाया या संग्रहीत किया जाता।

आपके ट्रांसक्रिप्ट में वक्ता लेबल: किसी रिकॉर्ड किए गए साक्षात्कार में किसने क्या कहा, यह लेबल करने के लिए, हम प्रोसेसिंग के दौरान प्रत्येक वक्ता की आवाज़ का एक अस्थायी गणितीय टेम्पलेट बनाते हैं; टेम्पलेट केवल लेबलिंग चलने तक रहता है और इसे कभी संग्रहीत नहीं किया जाता। टेम्पलेट केवल एक रिकॉर्डिंग के लिए बनाया जाता है और इसकी तुलना कभी किसी अन्य रिकॉर्डिंग से नहीं की जाती। वक्ता लेबल केवल आप और भर्ती टीम के वे सदस्य देख सकते हैं जिनके पास पहले से ही आपकी रिकॉर्डिंग और ट्रांसक्रिप्ट तक पहुंच है — लेबलिंग से किसी को नई पहुंच नहीं मिलती। लेबल का उपयोग केवल यह दिखाने के लिए किया जाता है कि ट्रांसक्रिप्ट में किसने क्या कहा; इनका उपयोग कभी किसी स्कोर, रेटिंग या मिलान निर्णय में नहीं किया जाता।

2. हम इसे कितने समय तक रखते हैं: हम बायोमेट्रिक टेम्पलेट संग्रहीत नहीं करते। कोई चेहरा एम्बेडिंग नहीं बनाई जाती, और हमारी अपनी प्रणालियों द्वारा कोई चेहरा या आवाज़ एम्बेडिंग नहीं रखी या संग्रहीत की जाती, इसलिए हटाने के लिए कोई संग्रहीत बायोमेट्रिक टेम्पलेट नहीं है। प्रति-टर्न व्यवहार माप: ऑब्ज़र्वर वाक् माप रिकॉर्ड किए जाने से 30 दिनों तक, अपने स्वयं के प्रतिधारण नियम के तहत रखे जाते हैं — वे वीडियो रिकॉर्डिंग के साथ नहीं हटाए जाते हैं। अवधि समाप्त होने पर स्वचालित हटाना अभी तक सक्षम नहीं है। स्पष्टता के लिए, वक्ता लेबलिंग ऊपर वर्णित टेम्पलेट से अलग है: इसका अस्थायी आवाज़ टेम्पलेट बिल्कुल संग्रहीत नहीं किया जाता, इसलिए बाद में हटाने के लिए कुछ नहीं रहता — लेबलिंग समाप्त होते ही वह समाप्त हो जाता है। वक्ता लेबल स्वयं ट्रांसक्रिप्ट के साथ उतने समय तक रहते हैं जितने समय तक रिकॉर्डिंग रखी जाती है, इस अनुभाग के नियम के तहत।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। हम GDPR के तहत 30 दिनों के भीतर या CCPA के तहत 45 दिनों के भीतर हटाने के अनुरोधों का जवाब देते हैं।

आपके अधिकार: आप बायोमेट्रिक विश्लेषण अस्वीकार कर सकते हैं और मानव-नेतृत्व वाले साक्षात्कार का अनुरोध कर सकते हैं। अस्वीकार करने से आपकी उम्मीदवारी प्रभावित नहीं होगी — एक मानव भर्तीकर्ता साक्षात्कार आयोजित करेगा। अस्वीकार करने का अर्थ यह भी है कि कोई वक्ता लेबलिंग नहीं होगी: आपके साक्षात्कार के लिए कोई वक्ता लेबल नहीं बनाए जाएंगे, और आपका ट्रांसक्रिप्ट बिना लेबल के रहेगा।`;

module.exports = {
	name: '304_consent_biometric_v15',
	up: async (client) => {
		await client.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi, effective_from)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (consent_type, version) DO NOTHING`,
			['biometric', '1.5', BIOMETRIC_TEXT_EN, BIOMETRIC_TEXT_HI],
		);
		console.log('Migration 304: consent text v1.5 inserted for biometric — §2 created correction (#2050)');
	},
	down: async (_client) => {
		// Intentional no-op. consent_texts is append-only (migration 245's
		// trigger forbids UPDATE/DELETE), so there is no lawful way to
		// "un-insert" v1.5 — and reverting would restore the §2
		// 'created' contradiction this migration corrects.
		// migrate.js never calls down(); one-way.
	},
};
