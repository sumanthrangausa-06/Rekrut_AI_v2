// Shared AI-interviewer audio playback — extracted from mock-interview.tsx (#322).
// Plays TTS audio from a backend endpoint (Web Audio API, HTMLAudio fallback,
// browser speechSynthesis fallback), then optionally auto-starts voice recording.

import { useCallback, useRef } from 'react';
import { getToken } from '@/lib/api';

export interface InterviewerAudioOptions {
	/** Build the TTS request for a turn's text. */
	getTtsRequest: (text: string) => { url: string; body: Record<string, unknown> };
	onSpeakingChange: (speaking: boolean) => void;
	onError: (message: string | null) => void;
	/** Whether voice mode is active (AI should auto-listen after speaking). */
	// Optional voice-loop integration (mock-interview uses these for auto-record after AI speaks)
	isVoiceMode?: () => boolean;
	isRecording?: () => boolean;
	startRecording?: () => void;
}

export interface PlayBufferOptions {
	/** Called after playback ends (instead of the default auto-record). */
	onEnded?: () => void;
	/** Delay before auto-recording after speech, when no onEnded override. */
	autoRecordDelayMs?: number;
}

export function useInterviewerAudio(options: InterviewerAudioOptions) {
	const audioCtxRef = useRef<AudioContext | null>(null);
	const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
	const audioElRef = useRef<HTMLAudioElement | null>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;


	const ensureAudioContext = useCallback((): AudioContext => {
		if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
			audioCtxRef.current = new (window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		}
		if (audioCtxRef.current.state === 'suspended') {
			audioCtxRef.current.resume();
		}
		return audioCtxRef.current;
	}, []);

	const stopAudio = useCallback(() => {
		if (audioSourceRef.current) {
			try {
				audioSourceRef.current.stop();
			} catch {
				/* already stopped */
			}
			audioSourceRef.current = null;
		}
		if (audioElRef.current) {
			audioElRef.current.pause();
			audioElRef.current = null;
		}
		optionsRef.current.onSpeakingChange(false);
	}, []);

	/** Close the AudioContext (call on unmount). */
	const dispose = useCallback(() => {
		stopAudio();
		if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
			try {
				audioCtxRef.current.close();
			} catch {
				/* already closed */
			}
			audioCtxRef.current = null;
		}
	}, [stopAudio]);

	const speakWithBrowserTTS = useCallback((text: string): Promise<void> => {
		return new Promise((resolve) => {
			if (!window.speechSynthesis) {
				resolve();
				return;
			}
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.rate = 1.0;
			utterance.pitch = 1.0;
			utterance.volume = 1.0;

			const pickVoice = () => {
				const voices = window.speechSynthesis.getVoices();
				return (
					voices.find(
						(v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'),
					) ||
					voices.find(
						(v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('samantha'),
					) ||
					voices.find((v) => v.lang.startsWith('en-US')) ||
					voices.find((v) => v.lang.startsWith('en'))
				);
			};

			const voices = window.speechSynthesis.getVoices();
			if (voices.length === 0) {
				window.speechSynthesis.onvoiceschanged = () => {
					const preferred = pickVoice();
					if (preferred) utterance.voice = preferred;
				};
			} else {
				const preferred = pickVoice();
				if (preferred) utterance.voice = preferred;
			}

			const timeout = setTimeout(() => {
				resolve();
			}, 30000);

			const keepAlive = setInterval(() => {
				if (window.speechSynthesis.speaking) {
					window.speechSynthesis.resume();
				} else {
					clearInterval(keepAlive);
				}
			}, 5000);

			utterance.onend = () => {
				clearTimeout(timeout);
				clearInterval(keepAlive);
				resolve();
			};
			utterance.onerror = () => {
				clearTimeout(timeout);
				clearInterval(keepAlive);
				resolve();
			};

			window.speechSynthesis.speak(utterance);
		});
	}, []);

	/** Decode raw audio bytes and play them (Web Audio, HTMLAudio fallback). */
	const playAudioBuffer = useCallback(
		async (arrayBuffer: ArrayBuffer, playOpts: PlayBufferOptions = {}) => {
			const opts = optionsRef.current;
			opts.onSpeakingChange(true);
			const finish = () => {
				opts.onSpeakingChange(false);
				if (playOpts.onEnded) {
					playOpts.onEnded();
				} else if (optionsRef.current.isVoiceMode?.() && !optionsRef.current.isRecording?.()) {
					const delay = playOpts.autoRecordDelayMs ?? 0;
					if (delay > 0) setTimeout(() => optionsRef.current.startRecording?.(), delay);
					else optionsRef.current.startRecording?.();
				}
			};
			const ctx = ensureAudioContext();
			try {
				const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
				if (audioSourceRef.current) {
					try {
						audioSourceRef.current.stop();
					} catch {
						/* already stopped */
					}
				}
				const source = ctx.createBufferSource();
				source.buffer = audioBuffer;
				source.connect(ctx.destination);
				audioSourceRef.current = source;
				source.onended = () => {
					audioSourceRef.current = null;
					finish();
				};
				source.start();
			} catch {
				// Web Audio decode failed — fall back to the Audio element
				const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
				const audioUrl = URL.createObjectURL(blob);
				if (audioElRef.current) {
					audioElRef.current.pause();
					URL.revokeObjectURL(audioElRef.current.src);
				}
				const audio = new Audio(audioUrl);
				audioElRef.current = audio;
				audio.onended = () => {
					URL.revokeObjectURL(audioUrl);
					finish();
				};
				audio.onerror = () => {
					URL.revokeObjectURL(audioUrl);
					finish();
				};
				await audio.play();
			}
		},
		[ensureAudioContext],
	);

	const playInterviewerAudio = useCallback(
		async (text: string) => {
			const opts = optionsRef.current;
			if (!text) return;
			opts.onError(null);
			try {
				const token = getToken();
				const { url, body } = opts.getTtsRequest(text);
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify(body),
				});

				const contentType = response.headers.get('content-type') || '';
				if (contentType.includes('application/json') || !response.ok) {
					// TTS API unavailable — fall back to browser speech synthesis
					opts.onSpeakingChange(true);
					await speakWithBrowserTTS(text);
					opts.onSpeakingChange(false);
					if (optionsRef.current.isVoiceMode?.() && !optionsRef.current.isRecording?.()) {
						setTimeout(() => optionsRef.current.startRecording?.(), 500);
					}
					return;
				}

				const arrayBuffer = await response.arrayBuffer();
				if (arrayBuffer.byteLength < 100) {
					opts.onSpeakingChange(true);
					await speakWithBrowserTTS(text);
					opts.onSpeakingChange(false);
					if (optionsRef.current.isVoiceMode?.() && !optionsRef.current.isRecording?.()) {
						setTimeout(() => optionsRef.current.startRecording?.(), 500);
					}
					return;
				}

				await playAudioBuffer(arrayBuffer, { autoRecordDelayMs: 0 });
			} catch {
				try {
					opts.onSpeakingChange(true);
					await speakWithBrowserTTS(text);
				} catch {
					/* browser TTS also failed — give up silently */
				}
				opts.onSpeakingChange(false);
				if (optionsRef.current.isVoiceMode?.() && !optionsRef.current.isRecording?.()) {
					setTimeout(() => optionsRef.current.startRecording?.(), 500);
				}
			}
		},
		[playAudioBuffer, speakWithBrowserTTS],
	);

	return { playInterviewerAudio, playAudioBuffer, speakWithBrowserTTS, ensureAudioContext, stopAudio, dispose };
}
