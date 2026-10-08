/**
 * Shared transcription hygiene for all interview flows.
 *
 * Phase 1 (#447): Extracts the Whisper hallucination filter that was
 * duplicated across 4 paths in Phase 0:
 * - routes/interviews.js (mock voice-respond)
 * - routes/interviews.js (screening respond-voice)
 * - routes/interview-sessions.js (/respond)
 * - lib/qp-ai.js (Whisper enhancement path)
 *
 * All flows must use this module — do not duplicate the phrase list.
 */

'use strict';

/**
 * Known Whisper hallucination phrases on silent/near-silent audio.
 * Whisper was trained on subtitled video; on silence it often outputs
 * subtitle boilerplate ("Thank you for watching") or a bare "Thank you."
 *
 * Matching is case-insensitive substring. "Thank you." (with period) is
 * used instead of bare "Thank you" to avoid false-positives on legitimate
 * answers like "Thank you for the question...".
 */
const WHISPER_HALLUCINATION_PHRASES = [
	'ご視聴ありがとうございました',
	'視聴ありがとうございました',
	'ありがとうございました',
	'ご視聴ありがとうございます',
	'字幕',
	'サブスクライブ',
	'チャンネル登録',
	'谢谢观看',
	'感谢观看',
	'Sous-titres',
	'Sottotitoli',
	'Untertitel',
	'Thanks for watching',
	'Thank you for watching',
	'Thank you.',
	'Please subscribe',
	'Like and subscribe',
];

/**
 * Minimum length for a transcription to be considered valid.
 * Default is 5 (used by mock interview).
 *
 * Per-path overrides are INTENTIONAL, not tech debt:
 * - Screening uses 3 — yes/no questions ("Are you authorized?" → "Yes")
 * - AI interview uses 2 — conversational acknowledgments ("Ready?" → "OK")
 *
 * Pass the override: isValidTranscriptLength(text, 3)
 */
const MIN_TRANSCRIPT_LENGTH = 5;

/**
 * Minimum length for Whisper output to replace browser transcription
 * in Quick Practice. Separate from MIN_TRANSCRIPT_LENGTH because it
 * serves a different purpose: "is Whisper better than what we have?"
 * rather than "is this a valid transcription?"
 */
const MIN_WHISPER_REPLACEMENT_LENGTH = 20;

/**
 * Check if transcribed text matches a known Whisper hallucination.
 *
 * @param {string} text - The transcribed text to check
 * @returns {{ isHallucination: boolean, matched?: string }} - matched is the phrase that triggered
 */
function filterWhisperHallucination(text) {
	if (!text || typeof text !== 'string') {
		return { isHallucination: false };
	}
	const lowerText = text.toLowerCase();
	for (const phrase of WHISPER_HALLUCINATION_PHRASES) {
		if (lowerText.includes(phrase.toLowerCase())) {
			return { isHallucination: true, matched: phrase };
		}
	}
	return { isHallucination: false };
}

/**
 * Check if transcribed text meets the minimum length requirement.
 *
 * @param {string} text - The transcribed text to check
 * @param {number} [minLength=MIN_TRANSCRIPT_LENGTH] - Override the default
 * @returns {boolean} - true if the text is long enough to be valid
 */
function isValidTranscriptLength(text, minLength = MIN_TRANSCRIPT_LENGTH) {
	return !!(text && text.trim().length >= minLength);
}

module.exports = {
	WHISPER_HALLUCINATION_PHRASES,
	MIN_TRANSCRIPT_LENGTH,
	MIN_WHISPER_REPLACEMENT_LENGTH,
	filterWhisperHallucination,
	isValidTranscriptLength,
};
