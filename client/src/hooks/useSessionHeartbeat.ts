/**
 * S-063 (#713): Session heartbeat + pause/resume lifecycle for the interview UI.
 *
 * Sends `POST /interviews/sessions/:id/heartbeat` every 20s while the session
 * is active (≤ timeout/3 per the S-003 client contract; timeout defaults to 60s).
 *
 * Design decisions (STOP 1, approved):
 * - iOS Safari suspends background timers → heartbeats stop → the backend
 *   auto-pauses within 60s. This is DESIRED (a backgrounded interview should
 *   pause). On foreground return, GET /state detects the pause.
 * - No final heartbeat on pagehide — let the backend auto-pause trigger.
 * - 409 SESSION_STATE_CONFLICT on heartbeat → poll GET /state to confirm
 *   auto-pause, then surface the paused state (AC-2).
 * - Pause: `PATCH /state {to_state: 'paused'}` (no POST /pause exists — AC-3's
 *   paths were approximate). Resume: `POST /resume {invite_token}`.
 * - 409s map to user-friendly copy (AC-4), never raw backend messages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/api';

/** Heartbeat interval: ≤ heartbeat-timeout/3 (60s default → 20s). */
export const HEARTBEAT_INTERVAL_MS = 20_000;

export type HeartbeatState = 'active' | 'paused' | 'ended';

interface UseSessionHeartbeatOptions {
	sessionId: number | null;
	inviteToken: string | null;
	/** Heartbeat only while the interview phase is active. */
	enabled: boolean;
	/** Called when the backend auto-paused the session (stale heartbeat). */
	onAutoPaused?: () => void;
	/** Called when the backend reports a terminal status (e.g. completed). */
	onSessionEnded?: (status: string) => void;
	/** Called after a successful resume (e.g. to clear stale notices). */
	onResumed?: () => void;
}

interface ApiError extends Error {
	code?: string;
	status?: number;
}

function isStateConflict(err: unknown): boolean {
	const e = err as ApiError;
	return e?.code === 'SESSION_STATE_CONFLICT' || e?.status === 409;
}

/** AC-4: user-friendly copy for invalid transitions — never raw backend text. */
export function friendlyLifecycleError(err: unknown): string {
	if (isStateConflict(err)) {
		return 'This action isn\u2019t available right now \u2014 the session state has changed. Please refresh the page.';
	}
	return 'Something went wrong. Please try again.';
}

export function useSessionHeartbeat({
	sessionId,
	inviteToken,
	enabled,
	onAutoPaused,
	onSessionEnded,
	onResumed,
}: UseSessionHeartbeatOptions) {
	const [heartbeatState, setHeartbeatState] = useState<HeartbeatState>('active');
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	// Latest callback refs — avoids stale closures without re-creating the interval.
	const onAutoPausedRef = useRef(onAutoPaused);
	const onSessionEndedRef = useRef(onSessionEnded);
	const onResumedRef = useRef(onResumed);
	useEffect(() => {
		onAutoPausedRef.current = onAutoPaused;
		onSessionEndedRef.current = onSessionEnded;
		onResumedRef.current = onResumed;
	});
	// M3: suppress the auto-pause notice when the pause was explicit (the user
	// clicked Pause). An in-flight heartbeat may 409 after pause() succeeds —
	// that is not a connection loss.
	const explicitPauseRef = useRef(false);
	// L1: guard against double-clicks while a pause/resume is in flight.
	const busyRef = useRef(false);

	const clearError = useCallback(() => setError(null), []);

	/**
	 * AC-2 + M1: confirm what the server did after a heartbeat conflict.
	 * Handles 'paused' (auto-pause) and terminal states ('completed', etc.).
	 */
	const checkAutoPaused = useCallback(async () => {
		if (!sessionId) return;
		try {
			const res = await apiCall<{ session: { status: string } }>(
				`/interviews/sessions/${sessionId}/state`,
			);
			const status = res.session?.status;
			if (status === 'paused') {
				setHeartbeatState('paused');
				// M3: explicit pauses don't trigger the "connection lost" notice.
				if (!explicitPauseRef.current) {
					onAutoPausedRef.current?.();
				}
				explicitPauseRef.current = false;
			} else if (status === 'completed' || status === 'abandoned' || status === 'expired') {
				// M1: terminal status — stop beating, surface it. Never loop.
				setHeartbeatState('ended');
				onSessionEndedRef.current?.(status);
			}
		} catch {
			// Best-effort: the next interval tick retries.
		}
	}, [sessionId]);

	const sendHeartbeat = useCallback(async () => {
		if (!sessionId) return;
		try {
			await apiCall(`/interviews/sessions/${sessionId}/heartbeat`, {
				method: 'POST',
			});
		} catch (err) {
			if (isStateConflict(err)) {
				// Session paused/completed server-side — confirm via GET /state.
				await checkAutoPaused();
			}
			// Other errors (network blips): swallow — next tick retries.
		}
	}, [sessionId, checkAutoPaused]);

	/** AC-3: pause the session explicitly. */
	const pause = useCallback(async () => {
		if (!sessionId || busyRef.current) return;
		busyRef.current = true;
		try {
			// M3: mark explicit so an in-flight heartbeat's 409 doesn't fire
			// the "connection lost" notice.
			explicitPauseRef.current = true;
			await apiCall(`/interviews/sessions/${sessionId}/state`, {
				method: 'PATCH',
				body: { to_state: 'paused' },
			});
			setHeartbeatState('paused');
			setError(null);
		} catch (err) {
			explicitPauseRef.current = false;
			setError(friendlyLifecycleError(err));
		} finally {
			busyRef.current = false;
		}
	}, [sessionId]);

	/** AC-3: resume via invite token (proves ownership). */
	const resume = useCallback(async () => {
		if (!sessionId || !inviteToken || busyRef.current) return;
		busyRef.current = true;
		try {
			await apiCall(`/interviews/sessions/${sessionId}/resume`, {
				method: 'POST',
				body: { invite_token: inviteToken },
			});
			setHeartbeatState('active');
			setError(null);
			// L5: clear any stale auto-pause notice.
			onResumedRef.current?.();
		} catch (err) {
			setError(friendlyLifecycleError(err));
		} finally {
			busyRef.current = false;
		}
	}, [sessionId, inviteToken]);

	// AC-1: heartbeat interval — runs only while enabled and not paused/ended.
	useEffect(() => {
		if (!enabled || !sessionId || heartbeatState !== 'active') return;
		void sendHeartbeat();
		intervalRef.current = setInterval(() => {
			void sendHeartbeat();
		}, HEARTBEAT_INTERVAL_MS);
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [enabled, sessionId, heartbeatState, sendHeartbeat]);

	// L2: foreground return — the suspended interval may take up to 20s to
	// fire; check state immediately when the tab becomes visible.
	useEffect(() => {
		if (!enabled || !sessionId) return;
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				void checkAutoPaused();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, [enabled, sessionId, checkAutoPaused]);

	return { heartbeatState, error, clearError, pause, resume };
}
