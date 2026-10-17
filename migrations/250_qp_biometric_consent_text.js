// =============================================================================
// Migration 250: QP-specific biometric consent text (S-066, Issue #719)
// =============================================================================
//
// S-066 C-1 (privacy engineer, UX architect): the 'biometric' consent text is
// interview/hiring copy ("90 days after the hiring decision", "request a
// human-led interview", "will not affect your candidacy"). Presenting it to
// Quick Practice users — a self-serve practice tool with no hiring decision,
// no candidacy, and no human-interview alternative — fails BIPA §15(b)'s
// "informed" prong and GDPR Art. 9 specificity.
//
// Fix: separate consent type 'biometric_practice' with QP-specific copy.
// NOT a version bump of 'biometric' — bumping would stale-out every existing
// interview receipt via the consent_text_version check.
//
// The text below is DRAFT — pending legal counsel review (standing Phase-3
// gate). The QP retention term ("90 days after your practice session") is a
// placeholder pending Sumanth/legal decision (M-2).
//
// Safety:
//   - CHECK constraint update is idempotent (drop-if-exists + re-add)
//   - Text insert uses ON CONFLICT DO NOTHING (idempotent)
// =============================================================================

const QP_BIOMETRIC_TEXT_EN = `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your practice video and audio — facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose. We do NOT label emotions or infer emotional states. These are measurements, not judgments. They are used only to give you coaching feedback on your practice response.

2. How long we keep it: Biometric templates and practice recordings are deleted 90 days after your practice session, unless you request earlier deletion. [RETENTION TERM PENDING LEGAL REVIEW — see S-066 M-2.]

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. Deletion is completed within 30 days.

Your rights: Video analysis is optional. You may decline and practice with a text response instead — you will still receive full coaching feedback. Declining does not affect your account or access to practice features.`;

const QP_BIOMETRIC_TEXT_HI = `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके अभ्यास वीडियो और ऑडियो से निकाले गए बायोमेट्रिक माप — चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं। इनका उपयोग केवल आपके अभ्यास उत्तर पर कोचिंग फीडबैक देने के लिए किया जाता है।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट और अभ्यास रिकॉर्डिंग आपके अभ्यास सत्र के 90 दिनों बाद हटा दिए जाते हैं, जब तक आप पहले हटाने का अनुरोध न करें। [प्रतिधारण अवधि कानूनी समीक्षा लंबित — S-066 M-2 देखें।]

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। 30 दिनों के भीतर हटाना पूर्ण किया जाता है।

आपके अधिकार: वीडियो विश्लेषण वैकल्पिक है। आप अस्वीकार कर सकते हैं और इसके बजाय टेक्स्ट उत्तर के साथ अभ्यास कर सकते हैं — आपको फिर भी पूर्ण कोचिंग फीडबैक मिलेगा। अस्वीकार करने से आपके खाते या अभ्यास सुविधाओं तक पहुंच प्रभावित नहीं होगी।`;

module.exports = {
	name: '250_qp_biometric_consent_text',
	up: async (client) => {
		// 1. Widen the CHECK constraint to allow the new type (idempotent).
		await client.query(`
			ALTER TABLE consent_texts DROP CONSTRAINT IF EXISTS consent_texts_consent_type_check;
		`);
		await client.query(`
			ALTER TABLE consent_texts
			ADD CONSTRAINT consent_texts_consent_type_check
			CHECK (consent_type IN ('recording','biometric','id_verification','biometric_practice'));
		`);

		// 2. Insert the QP-specific text (idempotent).
		await client.query(
			`INSERT INTO consent_texts (consent_type, version, text_en, text_hi)
			 VALUES ('biometric_practice', '1.0', $1, $2)
			 ON CONFLICT (consent_type, version) DO NOTHING`,
			[QP_BIOMETRIC_TEXT_EN, QP_BIOMETRIC_TEXT_HI]
		);
	},
	down: async (client) => {
		await client.query(
			`DELETE FROM consent_texts WHERE consent_type = 'biometric_practice'`
		);
		// Note: CHECK constraint is left widened (harmless; narrowing would
		// fail if rows of the removed type somehow remained).
	},
};
