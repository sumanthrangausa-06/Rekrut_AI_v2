/**
 * @jest-environment node
 *
 * Phase 0 (#447): Unit tests for the Whisper hallucination filter.
 *
 * The filter currently lives inline in 4 places:
 * - routes/interviews.js (mock voice-respond)
 * - routes/interviews.js (screening respond-voice)
 * - routes/interview-sessions.js (/respond)
 * - lib/qp-ai.js (Whisper enhancement path)
 *
 * Phase 1 extracts this to lib/transcription.js. These tests define the
 * expected behavior that the shared module must satisfy.
 */

'use strict';

// The canonical phrase list — must match all 4 inline copies.
const WHISPER_HALLUCINATIONS = [
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

// The matching logic — must match all 4 inline copies.
function isHallucination(text) {
	if (!text) return false;
	return WHISPER_HALLUCINATIONS.some((phrase) =>
		text.toLowerCase().includes(phrase.toLowerCase()),
	);
}

describe('Whisper hallucination filter', () => {
	describe('hallucinations are rejected', () => {
		test('bare "Thank you." is filtered (Phase 0 fix)', () => {
			expect(isHallucination('Thank you.')).toBe(true);
		});

		test('"thank you." lowercase variant is filtered', () => {
			expect(isHallucination('thank you.')).toBe(true);
		});

		test('"Thank you for watching" is filtered', () => {
			expect(isHallucination('Thank you for watching')).toBe(true);
		});

		test('"Thanks for watching" is filtered', () => {
			expect(isHallucination('Thanks for watching')).toBe(true);
		});

		test('Japanese subtitle phrases are filtered', () => {
			expect(isHallucination('ご視聴ありがとうございました')).toBe(true);
			expect(isHallucination('ありがとうございました')).toBe(true);
		});

		test('Chinese subtitle phrases are filtered', () => {
			expect(isHallucination('谢谢观看')).toBe(true);
		});

		test('European subtitle phrases are filtered', () => {
			expect(isHallucination('Sous-titres')).toBe(true);
			expect(isHallucination('Untertitel')).toBe(true);
		});

		test('"Please subscribe" is filtered', () => {
			expect(isHallucination('Please subscribe')).toBe(true);
		});
	});

	describe('legitimate answers are NOT filtered', () => {
		test('"Thank you for the question" is NOT filtered (no period after "you")', () => {
			// The filter uses "Thank you." (with period) specifically to avoid
			// false-positives on legitimate answers starting with "Thank you for..."
			expect(isHallucination('Thank you for the question, I have 5 years of experience')).toBe(false);
		});

		test('normal interview answer is NOT filtered', () => {
			expect(
				isHallucination(
					'In my previous role I led a team of 5 engineers building a microservices platform.',
				),
			).toBe(false);
		});

		test('empty string is NOT filtered', () => {
			expect(isHallucination('')).toBe(false);
		});

		test('null is NOT filtered', () => {
			expect(isHallucination(null)).toBe(false);
		});
	});

	describe('phrase list integrity', () => {
		test('no corrupted U+FFFD entries', () => {
			for (const phrase of WHISPER_HALLUCINATIONS) {
				expect(phrase).not.toMatch(/�/);
			}
		});

		test('Japanese thank-you entry is intact', () => {
			expect(WHISPER_HALLUCINATIONS).toContain('ありがとうございました');
		});

		test('bare "Thank you." entry exists', () => {
			expect(WHISPER_HALLUCINATIONS).toContain('Thank you.');
		});
	});
});
