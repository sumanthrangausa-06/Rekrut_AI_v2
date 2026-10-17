// =============================================================================
// Migration 244: Consent tables (S-010, Issue #568, Phase 4 Sprint 1)
// =============================================================================
//
// New tables (architecture §4, ConsentService 3.20):
//   consent_texts   — versioned consent copy, EN + HI (CR-10), source of truth
//                     for CR-21 re-consent. Middleware resolves current version
//                     server-side (MAX effective_from per type), never from request.
//   consent_receipts — per-session consent records. Withdrawal = UPDATE
//                     withdrawn_at in place. FK to consent_texts.
//
// Seeds: v1.0 text for recording / biometric / id_verification in EN + HI.
//        ALL COPY IS DRAFT — pending legal counsel review (Sumanth's decision).
//
// Safety:
//   - Every DDL statement uses IF NOT EXISTS (idempotent).
//   - Seeds use ON CONFLICT DO NOTHING (re-runnable).
//   - Does NOT touch the legacy `recording_consent` table (Phase 0 finding).
// =============================================================================

const CONSENT_TYPES = ['recording', 'biometric', 'id_verification'];

// DRAFT consent copy — pending legal counsel review. Do not treat as final.
// Hindi translations are draft-quality; native + legal review required.
const SEED_TEXTS = [
	{
		type: 'recording',
		version: '1.0',
		text_en: `DRAFT — pending legal counsel review.

1. What we collect: Video and audio recordings of your interview session, including your face, voice, and screen-shared content (if any).

2. How long we keep it: Recordings are deleted 90 days after the hiring decision is finalized, unless you request earlier deletion.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. Deletion is completed within 30 days.

Note: If you decline recording consent, the interview session cannot start. Recording is required to conduct the interview.`,
		text_hi: `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके साक्षात्कार सत्र की वीडियो और ऑडियो रिकॉर्डिंग, जिसमें आपका चेहरा, आवाज़ और साझा की गई स्क्रीन सामग्री (यदि कोई हो) शामिल है।

2. हम इसे कितने समय तक रखते हैं: भर्ती निर्णय अंतिम होने के 90 दिनों के बाद रिकॉर्डिंग हटा दी जाती है, जब तक आप पहले हटाने का अनुरोध न करें।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। 30 दिनों के भीतर हटाना पूर्ण किया जाता है।

नोट: यदि आप रिकॉर्डिंग सहमति अस्वीकार करते हैं, तो साक्षात्कार सत्र शुरू नहीं हो सकता। साक्षात्कार आयोजित करने के लिए रिकॉर्डिंग आवश्यक है।`,
	},
	{
		type: 'biometric',
		version: '1.0',
		text_en: `DRAFT — pending legal counsel review.

1. What we collect: Biometric measurements extracted from your video and audio — facial landmark positions, voice pitch range, speech rate, pause patterns, gaze direction, blink rate, and head pose. We do NOT label emotions or infer emotional states. These are measurements, not judgments.

2. How long we keep it: Biometric templates (face/voice embeddings) are deleted when the associated recording is deleted (90 days after the hiring decision). Per-turn behavioral measurements are deleted with the video recording.

3. How to delete: Email privacy@rekrutai.co or use the data-request portal. Deletion is completed within 30 days.

Your rights: You may decline biometric analysis and request a human-led interview instead. Declining will not affect your candidacy — a human recruiter will conduct the interview.`,
		text_hi: `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके वीडियो और ऑडियो से निकाले गए बायोमेट्रिक माप — चेहरे के लैंडमार्क स्थान, आवाज़ की पिच रेंज, बोलने की गति, विराम पैटर्न, दृष्टि दिशा, पलक झपकने की दर और सिर की स्थिति। हम भावनाओं को लेबल नहीं करते और न ही भावनात्मक अवस्थाओं का अनुमान लगाते हैं। ये माप हैं, निर्णय नहीं।

2. हम इसे कितने समय तक रखते हैं: बायोमेट्रिक टेम्पलेट (चेहरा/आवाज़ एम्बेडिंग) संबंधित रिकॉर्डिंग हटने पर हटा दिए जाते हैं (भर्ती निर्णय के 90 दिन बाद)। प्रति-टर्न व्यवहार माप वीडियो रिकॉर्डिंग के साथ हटा दिए जाते हैं।

3. कैसे हटाएं: privacy@rekrutai.co पर ईमेल करें या डेटा-अनुरोध पोर्टल का उपयोग करें। 30 दिनों के भीतर हटाना पूर्ण किया जाता है।

आपके अधिकार: आप बायोमेट्रिक विश्लेषण अस्वीकार कर सकते हैं और मानव-नेतृत्व वाले साक्षात्कार का अनुरोध कर सकते हैं। अस्वीकार करने से आपकी उम्मीदवारी प्रभावित नहीं होगी — एक मानव भर्तीकर्ता साक्षात्कार आयोजित करेगा।`,
	},
	{
		type: 'id_verification',
		version: '1.0',
		text_en: `DRAFT — pending legal counsel review.

1. What we collect: An image of your government-issued ID and a live facial capture used to match the ID photo (liveness check).

2. How long we keep it: ID images are deleted within 24 hours of identity verification. The verification result (pass/fail + timestamp) is retained per the data retention schedule.

3. How to delete: ID images auto-delete within 24 hours. For the verification result record, email privacy@rekrutai.co. Deletion is completed within 30 days.`,
		text_hi: `DRAFT — कानूनी सलाहकार की समीक्षा लंबित।

1. हम क्या एकत्र करते हैं: आपके सरकारी पहचान पत्र की छवि और आईडी फोटो से मिलान के लिए लाइव चेहरे की कैप्चर (लाइवनेस जांच)।

2. हम इसे कितने समय तक रखते हैं: पहचान सत्यापन के 24 घंटों के भीतर आईडी छवियां हटा दी जाती हैं। सत्यापन परिणाम (पास/फेल + टाइमस्टैम्प) डेटा प्रतिधारण अनुसूची के अनुसार रखा जाता है।

3. कैसे हटाएं: आईडी छवियां 24 घंटों के भीतर स्वतः हट जाती हैं। सत्यापन परिणाम रिकॉर्ड के लिए privacy@rekrutai.co पर ईमेल करें। 30 दिनों के भीतर हटाना पूर्ण किया जाता है।`,
	},
];

module.exports = {
	name: '244_consent_tables',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS consent_texts (
        consent_type VARCHAR(30) NOT NULL CHECK (consent_type IN ('recording','biometric','id_verification')),
        version VARCHAR(20) NOT NULL,
        text_en TEXT NOT NULL,
        text_hi TEXT NOT NULL,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (consent_type, version)
      )
    `);

		await client.query(`
      CREATE TABLE IF NOT EXISTS consent_receipts (
        id SERIAL PRIMARY KEY,
        interview_session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        candidate_id INTEGER NOT NULL,
        consent_type VARCHAR(30) NOT NULL CHECK (consent_type IN ('recording','biometric','id_verification')),
        consent_text_version VARCHAR(20) NOT NULL,
        consent_text_hash VARCHAR(64) NOT NULL,
        granted_at TIMESTAMPTZ,
        withdrawn_at TIMESTAMPTZ,
        CHECK (granted_at IS NOT NULL OR withdrawn_at IS NOT NULL),
        CHECK (withdrawn_at IS NULL OR (granted_at IS NOT NULL AND withdrawn_at >= granted_at)),
        FOREIGN KEY (consent_type, consent_text_version) REFERENCES consent_texts(consent_type, version),
        UNIQUE(interview_session_id, consent_type, consent_text_version)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_candidate ON consent_receipts(candidate_id)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_session ON consent_receipts(interview_session_id)
    `);

		// Seed v1.0 consent texts (DRAFT). Re-runnable via ON CONFLICT DO NOTHING.
		for (const seed of SEED_TEXTS) {
			if (!CONSENT_TYPES.includes(seed.type)) {
				throw new Error(`244_consent_tables: unknown consent type in seed: ${seed.type}`);
			}
			await client.query(
				`INSERT INTO consent_texts (consent_type, version, text_en, text_hi)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (consent_type, version) DO NOTHING`,
				[seed.type, seed.version, seed.text_en, seed.text_hi],
			);
		}
	},
};
