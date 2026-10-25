/**
 * @jest-environment node
 *
 * Phase 1 (#447): Unit tests for the shared lib/transcription.js module.
 * This is the single source of truth for Whisper hallucination filtering
 * across all 4 interview flows.
 */

'use strict';

const {
	WHISPER_HALLUCINATION_PHRASES,
	MIN_TRANSCRIPT_LENGTH,
	MIN_WHISPER_REPLACEMENT_LENGTH,
	filterWhisperHallucination,
	isValidTranscriptLength,
} = require('../lib/transcription');

describe('lib/transcription.js', () => {
	describe('filterWhisperHallucination', () => {
		test('returns isHallucination:true + matched phrase for "Thank you."', () => {
			const result = filterWhisperHallucination('Thank you.');
			expect(result.isHallucination).toBe(true);
			expect(result.matched).toBe('Thank you.');
		});

		test('is case-insensitive', () => {
			expect(filterWhisperHallucination('THANK YOU.').isHallucination).toBe(true);
			expect(filterWhisperHallucination('thank you.').isHallucination).toBe(true);
		});

		test('returns isHallucination:false for legitimate answers', () => {
			const result = filterWhisperHallucination(
				'In my previous role I led a team of 5 engineers.',
			);
			expect(result.isHallucination).toBe(false);
			expect(result.matched).toBeUndefined();
		});

		test('does NOT filter "Thank you for the question" (no period)', () => {
			const result = filterWhisperHallucination(
				'Thank you for the question, I have 5 years of experience',
			);
			expect(result.isHallucination).toBe(false);
		});

		test('handles null/undefined/empty safely', () => {
			expect(filterWhisperHallucination(null).isHallucination).toBe(false);
			expect(filterWhisperHallucination(undefined).isHallucination).toBe(false);
			expect(filterWhisperHallucination('').isHallucination).toBe(false);
		});

		test('handles non-string input safely', () => {
			expect(filterWhisperHallucination(123).isHallucination).toBe(false);
		});
	});

	describe('isValidTranscriptLength', () => {
		test('uses MIN_TRANSCRIPT_LENGTH (5) by default', () => {
			expect(MIN_TRANSCRIPT_LENGTH).toBe(5);
			expect(isValidTranscriptLength('Hello')).toBe(true); // 5 chars
			expect(isValidTranscriptLength('Hi')).toBe(false); // 2 chars
			expect(isValidTranscriptLength('')).toBe(false);
			expect(isValidTranscriptLength(null)).toBe(false);
		});

		test('accepts custom min length override', () => {
			expect(isValidTranscriptLength('Hi', 2)).toBe(true);
			expect(isValidTranscriptLength('H', 2)).toBe(false);
		});

		test('trims whitespace before checking', () => {
			expect(isValidTranscriptLength('  Hello  ')).toBe(true);
			expect(isValidTranscriptLength('   ')).toBe(false);
		});
	});

	describe('constants', () => {
		test('MIN_WHISPER_REPLACEMENT_LENGTH is 20', () => {
			expect(MIN_WHISPER_REPLACEMENT_LENGTH).toBe(20);
		});

		test('phrase list has no corrupted entries', () => {
			for (const phrase of WHISPER_HALLUCINATION_PHRASES) {
				expect(phrase).not.toMatch(/�/);
			}
		});

		test('phrase list includes critical entries', () => {
			expect(WHISPER_HALLUCINATION_PHRASES).toContain('Thank you.');
			expect(WHISPER_HALLUCINATION_PHRASES).toContain('ありがとうございました');
			expect(WHISPER_HALLUCINATION_PHRASES).toContain('Thank you for watching');
		});
	});
});
