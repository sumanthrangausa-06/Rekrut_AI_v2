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
// NOT edited in place. This migration UPDATEs the seeded row instead.
// Fresh installs run 244 then 272 in order, so they get the corrected text
// from this UPDATE too.
//
// Copy truth only — this migration changes NO retention/purge behaviour.
// The corrected text keeps the "DRAFT — pending legal counsel review"
// marking the 244 seed carries.
//
// Review BLOCK corrections (PR #1560, comment 6320517942):
//   1. NO deletion timeframe of any kind. The first version of this text
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
// Safety: the UPDATE is idempotent (re-running writes the same text).
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
			`UPDATE consent_texts
			 SET text_en = $1, text_hi = $2
			 WHERE consent_type = $3 AND version = $4`,
			[ID_VERIFICATION_TEXT_EN, ID_VERIFICATION_TEXT_HI, 'id_verification', '1.0'],
		);
		console.log('Migration 272: id_verification consent text corrected (#1559)');
	},
	down: async (_client) => {
		// No down: reverting would restore the false 24-hour / liveness claims
		// this migration removes. The correction is intentionally one-way.
	},
};
