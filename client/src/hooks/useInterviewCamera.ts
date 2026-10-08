// Shared camera hook for all interview flows — extracted from Quick Practice's
// battle-tested implementation ("13TH FIX", Feb 11 2026).
//
// Phase 2 (#447): Replaces 3 independent camera implementations:
// - quick-practice.tsx (original, 4 fallbacks with labels)
// - mock-interview.tsx (simplified copy, 2 fallbacks worth of logging)
// - InterviewSession.tsx (separate implementation)
//
// Improvements over the original:
// - useCallback-stable start/stop (safe for effect deps)
// - Stop-before-acquire (prevents track leaks on retry)
// - Built-in unmount-only teardown pattern

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraError = 'not_supported' | 'denied' | 'not_found' | 'unknown' | null;

export interface UseInterviewCameraOptions {
	/** Ref to the <video> element to attach the stream to. */
	videoRef: React.RefObject<HTMLVideoElement | null>;
	/** Called when camera state changes (for parent component sync). */
	onCameraReady?: (ready: boolean) => void;
	onCameraError?: (error: string | null) => void;
	onMicActive?: (active: boolean) => void;
}

export interface UseInterviewCameraReturn {
	cameraReady: boolean;
	cameraError: CameraError;
	cameraStatus: string;
	micActive: boolean;
	startCamera: () => Promise<void>;
	stopCamera: () => void;
	/** Get the active MediaStream (for MediaRecorder, etc.). */
	getStream: () => MediaStream | null;
}

const CONSTRAINT_SETS: Array<{
	video: MediaStreamConstraints['video'];
	audio: boolean;
	label: string;
}> = [
	{ video: { facingMode: 'user' }, audio: true, label: 'av:user' },
	{ video: true, audio: true, label: 'av:true' },
	{ video: { facingMode: 'user' }, audio: false, label: 'v:user' },
	{ video: true, audio: false, label: 'v:true' },
];

export function useInterviewCamera(
	options: UseInterviewCameraOptions,
): UseInterviewCameraReturn {
	const { videoRef, onCameraReady, onCameraError, onMicActive } = options;
	const streamRef = useRef<MediaStream | null>(null);
	const [cameraReady, setCameraReady] = useState(false);
	const [cameraError, setCameraError] = useState<CameraError>(null);
	const [cameraStatus, setCameraStatus] = useState('');
	const [micActive, setMicActive] = useState(false);

	// Keep callbacks in refs so startCamera/stopCamera stay stable.
	const callbacksRef = useRef({ onCameraReady, onCameraError, onMicActive });
	callbacksRef.current = { onCameraReady, onCameraError, onMicActive };

	const setError = useCallback((error: CameraError) => {
		setCameraError(error);
		callbacksRef.current.onCameraError?.(error as string | null);
	}, []);

	const setReady = useCallback((ready: boolean) => {
		setCameraReady(ready);
		callbacksRef.current.onCameraReady?.(ready);
	}, []);

	const setMic = useCallback((active: boolean) => {
		setMicActive(active);
		callbacksRef.current.onMicActive?.(active);
	}, []);

	const stopCamera = useCallback(() => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => {
				track.stop();
			});
			streamRef.current = null;
		}
		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}
		setCameraReady(false);
		setCameraError(null);
		setCameraStatus('');
		setMicActive(false);
	}, [videoRef]);

	const startCamera = useCallback(async () => {
		// Stop-before-acquire: prevent track leaks on retry.
		stopCamera();

		try {
			setError(null);
			setReady(false);
			setCameraStatus('Requesting camera...');

			if (!navigator.mediaDevices?.getUserMedia) {
				setError('not_supported');
				setCameraStatus('Camera not supported');
				return;
			}

			let videoStream: MediaStream | null = null;

			for (const { video: vc, audio: ac, label } of CONSTRAINT_SETS) {
				try {
					setCameraStatus(`Trying ${label}...`);
					videoStream = await navigator.mediaDevices.getUserMedia({
						video: vc,
						...(ac ? { audio: true } : {}),
					});

					const vt = videoStream.getVideoTracks()[0];
					if (vt?.readyState !== 'live') {
						console.warn(`[camera] ${label}: no live video track`);
						videoStream.getTracks().forEach((t) => {
							t.stop();
						});
						videoStream = null;
						continue;
					}

					const settings = vt.getSettings?.() || {};
					const at = videoStream.getAudioTracks();
					console.log(
						`[camera] ${label}: track=${vt.readyState} ${settings.width}x${settings.height} audio:${at.length}`,
					);
					setCameraStatus(
						`Got ${label}: ${settings.width || '?'}x${settings.height || '?'} ${at.length > 0 ? '🎙' : ''}`,
					);
					break;
				} catch (err: any) {
					console.warn(`[camera] ${label} error: ${err?.name} ${err?.message}`);
					setCameraStatus(`${label}: ${err?.name}`);
					if (err.name === 'NotAllowedError' && !ac) {
						setError('denied');
						return;
					}
				}
			}

			if (!videoStream) {
				setError('not_found');
				setCameraStatus('Camera not working — tap Retry');
				return;
			}

			streamRef.current = videoStream;

			const audioTracks = videoStream.getAudioTracks();
			if (audioTracks.length > 0) {
				setMic(true);
				console.log(`[camera] mic active: ${audioTracks[0].label}`);
			} else {
				setMic(false);
				console.log('[camera] no audio track — mic not available');
			}

			const v = videoRef.current;
			if (v) {
				v.srcObject = videoStream;
				try {
					await v.play();
					console.log(
						`[camera] play() succeeded, readyState=${v.readyState}, videoWidth=${v.videoWidth}`,
					);
				} catch (e: any) {
					console.warn('[camera] play() failed, retrying:', e?.message);
					try {
						await v.play();
					} catch (err) {
						console.error('[camera] play() retry failed:', err);
					}
				}
			}

			const vt = videoStream.getVideoTracks()[0];
			const at2 = videoStream.getAudioTracks();
			const settings = vt?.getSettings?.() || {};
			setCameraStatus(
				`OK ${settings.width || '?'}x${settings.height || '?'} ${at2.length > 0 ? '🎙' : ''} ▶`,
			);

			setReady(true);

			if (vt) {
				vt.addEventListener('ended', () => {
					console.warn('[camera] video track ended');
					setReady(false);
					setError('denied');
					setCameraStatus('Track ended');
				});
			}
		} catch (err: any) {
			console.error('Camera access error:', err?.name, err?.message);
			setCameraStatus(`Error: ${err?.name} ${err?.message}`);
			if (err.name === 'NotAllowedError') {
				setError('denied');
			} else if (err.name === 'NotFoundError') {
				setError('not_found');
			} else {
				setError('unknown');
			}
		}
	}, [stopCamera, videoRef, setError, setReady, setMic]);

	// Unmount-only teardown. Uses a ref to avoid the #447-class bug where
	// listing stopCamera as a dep kills the camera on every re-render.
	const teardownRef = useRef(stopCamera);
	teardownRef.current = stopCamera;
	useEffect(() => {
		return () => {
			teardownRef.current();
		};
	}, []);

	return {
		cameraReady,
		cameraError,
		cameraStatus,
		micActive,
		startCamera,
		stopCamera,
		getStream: () => streamRef.current,
	};
}
