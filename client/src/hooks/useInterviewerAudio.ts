// Shared AI-interviewer audio playback — extracted from mock-interview.tsx (#322).
// Plays TTS audio from a backend endpoint (Web Audio API, HTMLAudio fallback,
// browser speechSynthesis fallback), then optionally auto-starts voice recording.

import { useCallback, useEffect, useRef } from 'react';
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

// --- iOS audio session routing -------------------------------------------
// While the mic is held open during an interview, iOS puts the audio
// session in play-and-record mode and routes HTMLAudio output to the
// earpiece (phone-call behavior), making the AI voice inaudible.
// Spike test confirmed navigator.audioSession exists on iOS and accepts
// type changes. Set "playback" before the AI speaks so the voice goes
// through the speaker; restore "play-and-record" when done so the mic
// keeps working. All iOS-gated — desktop behavior is untouched.

type IOSAudioSessionType = 'playback' | 'play-and-record';

const isIOSDevice = (): boolean =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) ||
	(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

interface NavigatorWithAudioSession extends Navigator {
	audioSession?: { type: string };
}

function setAudioSessionType(type: IOSAudioSessionType): void {
	if (!isIOSDevice()) return;
	const nav = navigator as NavigatorWithAudioSession;
	if (!nav.audioSession) return;
	try {
		nav.audioSession.type = type;
	} catch {
		/* audioSession unsupported — leave routing to iOS defaults */
	}
}

export function useInterviewerAudio(options: InterviewerAudioOptions) {
	const audioCtxRef = useRef<AudioContext | null>(null);
	const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
	const audioElRef = useRef<HTMLAudioElement | null>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;
	/** Tracks the currently desired iOS session type (for devicechange re-assert). */
	const sessionTypeRef = useRef<IOSAudioSessionType>('play-and-record');

	const applySessionType = useCallback((type: IOSAudioSessionType) => {
		sessionTypeRef.current = type;
		setAudioSessionType(type);
	}, []);

	// Re-assert the current session type when the output route changes
	// (e.g. AirPods disconnected mid-interview — iOS reroutes automatically
	// but may reset the session type). iOS-only.
	useEffect(() => {
		if (!isIOSDevice()) return;
		const onDeviceChange = () => {
			setAudioSessionType(sessionTypeRef.current);
		};
		try {
			navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
		} catch {
			/* mediaDevices unavailable */
		}
		return () => {
			try {
				navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
			} catch {
				/* ignore */
			}
		};
	}, []);


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
		// iOS: restore mic mode in case playback was interrupted mid-speech.
		applySessionType('play-and-record');
		if (audioSourceRef.current) {
			// Phase 0 (#447): null the onended handler BEFORE stopping.
			// Otherwise the old source's onended fires finish(), corrupting
			// state (onSpeakingChange(false) + auto-record) while new audio
			// is starting.
			audioSourceRef.current.onended = null;
			try {
				audioSourceRef.current.stop();
			} catch {
				/* already stopped */
			}
			audioSourceRef.current = null;
		}
		if (audioElRef.current) {
			audioElRef.current.pause();
			// Phase 0 (#447): revoke the blob URL to prevent memory leak.
			// The playAudioBuffer fallback path revokes on replace, but
			// stopAudio() never did.
			try {
				URL.revokeObjectURL(audioElRef.current.src);
			} catch {
				/* not a blob URL */
			}
			audioElRef.current = null;
		}
		optionsRef.current.onSpeakingChange(false);
	}, [applySessionType]);

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
			// iOS: route TTS voice to speaker, restore mic mode when done.
			const done = () => {
				applySessionType('play-and-record');
				resolve();
			};
			applySessionType('playback');
			if (!window.speechSynthesis) {
				done();
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
				done();
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
				done();
			};
			utterance.onerror = () => {
				clearTimeout(timeout);
				clearInterval(keepAlive);
				done();
			};

			window.speechSynthesis.speak(utterance);
		});
	}, [applySessionType]);

	/** Decode raw audio bytes and play them (Web Audio, HTMLAudio fallback). */
	const playAudioBuffer = useCallback(
		async (arrayBuffer: ArrayBuffer, playOpts: PlayBufferOptions = {}) => {
			const opts = optionsRef.current;
			// iOS: route AI voice to speaker (not earpiece) while it plays.
			applySessionType('playback');
			opts.onSpeakingChange(true);
			const finish = () => {
				// iOS: restore mic mode so the next recording works.
				applySessionType('play-and-record');
				opts.onSpeakingChange(false);
				if (playOpts.onEnded) {
					playOpts.onEnded();
				} else if (optionsRef.current.isVoiceMode?.() && !optionsRef.current.isRecording?.()) {
					const delay = playOpts.autoRecordDelayMs ?? 0;
					if (delay > 0) setTimeout(() => optionsRef.current.startRecording?.(), delay);
					else optionsRef.current.startRecording?.();
				}
			};
			// iOS: Web Audio API playback is blocked while the mic is active
			// (getUserMedia holds the audio session), so TTS played through
			// AudioContext only sounds after the mic is released. Route iOS
			// straight to the HTMLAudio element instead.
			const isIOS =
				/iPad|iPhone|iPod/.test(navigator.userAgent) ||
				(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
			if (!isIOS) {
				const ctx = ensureAudioContext();
				try {
					const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
					if (audioSourceRef.current) {
						// Phase 0 (#447): null onended before stopping the old source,
						// otherwise its finish() fires and corrupts the new playback state.
						audioSourceRef.current.onended = null;
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
					return;
				} catch {
					// Web Audio failed — fall through to the Audio element below
				}
			}
			// HTMLAudio path: fallback on desktop, primary path on iOS
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
			try {
				await audio.play();
			} catch (e) {
				// play() rejected (e.g. autoplay blocked) — restore the
				// session before propagating so the mic keeps working.
				finish();
				throw e;
			}
		},
		[ensureAudioContext, applySessionType],
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
