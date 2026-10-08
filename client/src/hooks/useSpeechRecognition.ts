// Shared Web Speech API detection for all interview flows.
//
// Phase 3 (#447): Centralizes the "is voice input available?" check.
// Previously each flow did its own `(window as any).SpeechRecognition ||
// (window as any).webkitSpeechRecognition` check and silently returned
// when absent, leaving users on Chrome iOS / Safari / Firefox with no
// indication and no fallback.

import { useMemo } from 'react';

/**
 * Check if the Web Speech API (SpeechRecognition) is available.
 * Returns false on Chrome iOS, Safari, Firefox — all browsers where
 * the API is absent. Callers should show a typed-answer fallback.
 */
export function isSpeechRecognitionAvailable(): boolean {
	if (typeof window === 'undefined') return false;
	return !!(
		(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
	);
}

/**
 * React hook version — memoizes the check (it never changes at runtime).
 */
export function useSpeechRecognitionAvailable(): boolean {
	return useMemo(() => isSpeechRecognitionAvailable(), []);
}

/**
 * User-facing message when voice input is unavailable.
 */
export const SPEECH_NOT_SUPPORTED_MESSAGE =
	"Voice input isn't supported on this browser — type your answer instead.";
