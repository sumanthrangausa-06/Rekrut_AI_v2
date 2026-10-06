/**
 * Track A voice room join (Phase 2, #323).
 *
 * Thin adapter over livekit-client: on candidate join it fetches a session
 * token, dispatches the voice agent (fire-and-forget — dispatch failures are
 * silent by design, spec §6; skipped when dispatchMode is null, i.e. human
 * interviews), and connects the room with camera+mic.
 * The voice agent does NOT publish transcript data events; it persists turns
 * to interview_sessions.conversation after every turn (worker.mjs), so this
 * hook polls the transcript endpoint while live and reports new turns via
 * onTranscript. Any failure (no WebRTC, token error, connect error) resolves
 * to the 'fallback' state — the caller keeps rendering the Phase 1 HTTP-turn
 * UI, which is the acceptance-critical fallback path.
 */

import { Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/api';

export type VoiceState = 'idle' | 'connecting' | 'live' | 'fallback';

export interface VoiceRoomTurn {
	role: string;
	text: string;
	timestamp?: string;
}

interface UseVoiceRoomOptions {
	sessionId: number;
	candidateName: string;
	/** Camera is only enabled when the candidate granted video consent. */
	videoEnabled: boolean;
	onTranscript: (turns: VoiceRoomTurn[]) => void;
	/**
	 * Full-branch review C1 (#323): for human interviews (Track B) the
	 * candidate joins the room but NO agent is dispatched. `null` skips the
	 * dispatch call while keeping the room join; default 'interviewer'
	 * preserves Track A behavior.
	 */
	dispatchMode?: 'interviewer' | null;
}

interface TokenResponse {
	token: string;
	roomName: string;
	livekitUrl: string;
}

interface TranscriptResponse {
	success: boolean;
	conversation: VoiceRoomTurn[];
}

const TRANSCRIPT_POLL_MS = 3000;

export function useVoiceRoom({
	sessionId,
	candidateName,
	videoEnabled,
	onTranscript,
	dispatchMode = 'interviewer',
}: UseVoiceRoomOptions) {
	const [voiceState, setVoiceState] = useState<VoiceState>('idle');
	const voiceStateRef = useRef<VoiceState>('idle');
	const setVoiceStateSync = useCallback((s: VoiceState) => {
		voiceStateRef.current = s;
		setVoiceState(s);
	}, []);
	const roomRef = useRef<Room | null>(null);
	const startingRef = useRef(false);
	const stoppedRef = useRef(false);
	const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const lastTranscriptLenRef = useRef(0);
	const onTranscriptRef = useRef(onTranscript);
	onTranscriptRef.current = onTranscript;

	const stopPolling = useCallback(() => {
		if (pollTimerRef.current) {
			clearInterval(pollTimerRef.current);
			pollTimerRef.current = null;
		}
	}, []);

	const stop = useCallback(() => {
		stoppedRef.current = true;
		stopPolling();
		try {
			roomRef.current?.disconnect();
		} catch {
			// disconnect is best-effort on teardown
		}
		roomRef.current = null;
		setVoiceStateSync('idle');
	}, [stopPolling, setVoiceStateSync]);

	// Consent withdrawal mid-call must also kill the room's camera track —
	// stopping the local preview alone would leave video streaming to the room.
	const setVideoEnabled = useCallback(async (enabled: boolean) => {
		try {
			await roomRef.current?.localParticipant.setCameraEnabled(enabled);
		} catch {
			// best-effort; the room may already be gone
		}
	}, []);

	const start = useCallback(async (): Promise<VoiceState> => {
		// Double-click guard (Task 2 concern): one join per hook instance.
		if (startingRef.current || roomRef.current) return voiceStateRef.current;
		startingRef.current = true;
		stoppedRef.current = false;
		try {
			// No WebRTC → the Phase 1 HTTP-turn UI is the path, no token request.
			if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
				setVoiceStateSync('fallback');
				return 'fallback';
			}
			setVoiceStateSync('connecting');
			const tokenData = await apiCall<TokenResponse>(
				`/livekit/session-rooms/${sessionId}/token`,
				{ method: 'POST', body: { name: candidateName } },
			);
			// Fire-and-forget: dispatch failures must never surface to the
			// candidate (spec §6). The interview continues over HTTP turns.
			// C1 (#323): dispatchMode null (human interviews) skips the
			// dispatch entirely — the candidate still joins the room.
			if (dispatchMode !== null) {
				apiCall(`/livekit/session-rooms/${sessionId}/dispatch`, {
					method: 'POST',
					body: { mode: dispatchMode },
				}).catch(() => {});
			}

			const room = new Room();
			roomRef.current = room;
			// Play the agent's voice: attach remote audio tracks to an element.
			room.on(RoomEvent.TrackSubscribed, (track) => {
				if (track.kind === Track.Kind.Audio) {
					const el = track.attach();
					el.play().catch(() => {});
				}
			});
			await room.connect(tokenData.livekitUrl, tokenData.token);
			await room.localParticipant.setMicrophoneEnabled(true);
			if (videoEnabled) {
				await room.localParticipant.setCameraEnabled(true);
			}
			setVoiceStateSync('live');

			const poll = async () => {
				if (stoppedRef.current) return;
				try {
					const data = await apiCall<TranscriptResponse>(
						`/livekit/session-rooms/${sessionId}/transcript`,
					);
					const conv = data.conversation || [];
					if (conv.length > lastTranscriptLenRef.current) {
						lastTranscriptLenRef.current = conv.length;
						onTranscriptRef.current(conv);
					}
				} catch {
					// Transient — the next poll retries.
				}
			};
			void poll();
			pollTimerRef.current = setInterval(poll, TRANSCRIPT_POLL_MS);
			return 'live';
		} catch {
			roomRef.current = null;
			setVoiceStateSync('fallback');
			return 'fallback';
		} finally {
			startingRef.current = false;
		}
	}, [sessionId, candidateName, videoEnabled, dispatchMode, setVoiceStateSync]);

	useEffect(() => {
		return () => {
			stoppedRef.current = true;
			stopPolling();
			try {
				roomRef.current?.disconnect();
			} catch {
				// ignore on unmount
			}
			roomRef.current = null;
		};
	}, [stopPolling]);

	return { voiceState, start, stop, setVideoEnabled };
}
