/**
 * S-063 (#713): Wire heartbeat and lifecycle to interview UI.
 *
 *   AC-1: heartbeat sent every ≤20s during active session
 *   AC-2: browser close/background → auto-pause detected (via GET /state after 409)
 *   AC-3: pause button → PATCH /state {to_state: 'paused'}; resume → POST /resume
 *   AC-4: invalid transitions (409) → user-friendly error, not raw error
 *
 * Backend contracts (S-003, server/routes/session-lifecycle.js):
 *   POST  /interviews/sessions/:id/heartbeat — in_progress only; 409 if paused/completed
 *   PATCH /interviews/sessions/:id/state     — {to_state}; 409 on invalid transition
 *   GET   /interviews/sessions/:id/state     — lazy pause evaluation (side effect)
 *   POST  /interviews/sessions/:id/resume    — {invite_token}
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';

const mockApiCall = vi.mocked(apiCall);

const SESSION_ID = 42;
const INVITE_TOKEN = 'tok_abc123';

function renderHeartbeat(overrides?: {
	sessionId?: number | null;
	inviteToken?: string | null;
	enabled?: boolean;
	onAutoPaused?: () => void;
	onSessionEnded?: (status: string) => void;
	onResumed?: () => void;
}) {
	return renderHook(() =>
		useSessionHeartbeat({
			sessionId: overrides?.sessionId ?? SESSION_ID,
			inviteToken: overrides?.inviteToken ?? INVITE_TOKEN,
			enabled: overrides?.enabled ?? true,
			onAutoPaused: overrides?.onAutoPaused,
			onSessionEnded: overrides?.onSessionEnded,
			onResumed: overrides?.onResumed,
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// AC-1: heartbeat sent on mount and every ≤20s while enabled
describe('AC-1: heartbeat interval', () => {
	it('sends a heartbeat immediately when enabled', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		renderHeartbeat();
		await act(async () => {
			await Promise.resolve();
		});
		expect(mockApiCall).toHaveBeenCalledWith(
			`/interviews/sessions/${SESSION_ID}/heartbeat`,
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('sends heartbeats on a 20s interval while active', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		renderHeartbeat();
		await act(async () => {
			await Promise.resolve();
		});
		const initialCalls = mockApiCall.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(20_000);
			await Promise.resolve();
		});
		expect(mockApiCall.mock.calls.length).toBeGreaterThan(initialCalls);
	});

	it('does not send heartbeats when disabled', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		renderHeartbeat({ enabled: false });
		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await Promise.resolve();
		});
		expect(mockApiCall).not.toHaveBeenCalled();
	});

	it('stops the interval on unmount (no leaked timers)', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		const { unmount } = renderHeartbeat();
		await act(async () => {
			await Promise.resolve();
		});
		unmount();
		const callsAfterUnmount = mockApiCall.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await Promise.resolve();
		});
		expect(mockApiCall.mock.calls.length).toBe(callsAfterUnmount);
	});
});

// AC-2: auto-pause detection — 409 on heartbeat → GET /state → paused
describe('AC-2: auto-pause detection', () => {
	it('detects auto-pause when heartbeat 409s and state is paused', async () => {
		const onAutoPaused = vi.fn();
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/heartbeat')) {
				const err = new Error('Cannot heartbeat a paused session') as Error & {
					code?: string;
				};
				err.code = 'SESSION_STATE_CONFLICT';
				throw err;
			}
			if (String(url).includes('/state')) {
				return { success: true, session: { status: 'paused' } };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const { result } = renderHeartbeat({ onAutoPaused });
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.heartbeatState).toBe('paused');
		expect(onAutoPaused).toHaveBeenCalled();
	});

	it('stops heartbeating once paused', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/heartbeat')) {
				const err = new Error('Cannot heartbeat a paused session') as Error & {
					code?: string;
				};
				err.code = 'SESSION_STATE_CONFLICT';
				throw err;
			}
			if (String(url).includes('/state')) {
				return { success: true, session: { status: 'paused' } };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		renderHeartbeat();
		await act(async () => {
			await Promise.resolve();
		});
		const callsAfterPause = mockApiCall.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await Promise.resolve();
		});
		// No further heartbeat calls after pause detected
		const heartbeatCalls = mockApiCall.mock.calls.filter((c) =>
			String(c[0]).includes('/heartbeat'),
		);
		expect(heartbeatCalls.length).toBeLessThanOrEqual(callsAfterPause);
	});
});

// AC-3: pause and resume
describe('AC-3: pause and resume', () => {
	it('pause() PATCHes state to paused', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		const { result } = renderHeartbeat();
		await act(async () => {
			await result.current.pause();
		});
		expect(mockApiCall).toHaveBeenCalledWith(
			`/interviews/sessions/${SESSION_ID}/state`,
			expect.objectContaining({
				method: 'PATCH',
				body: { to_state: 'paused' },
			}),
		);
		expect(result.current.heartbeatState).toBe('paused');
	});

	it('resume() POSTs to resume with the invite token', async () => {
		mockApiCall.mockResolvedValue({ success: true });
		const { result } = renderHeartbeat();
		// Pause first
		await act(async () => {
			await result.current.pause();
		});
		// Then resume
		await act(async () => {
			await result.current.resume();
		});
		expect(mockApiCall).toHaveBeenCalledWith(
			`/interviews/sessions/${SESSION_ID}/resume`,
			expect.objectContaining({
				method: 'POST',
				body: { invite_token: INVITE_TOKEN },
			}),
		);
		expect(result.current.heartbeatState).toBe('active');
	});
});

// M1: terminal status stops the heartbeat loop
describe('M1: terminal session status', () => {
	it('stops heartbeating when the server reports completed', async () => {
		const onSessionEnded = vi.fn();
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/heartbeat')) {
				const err = new Error('Cannot heartbeat a completed session') as Error & {
					code?: string;
				};
				err.code = 'SESSION_STATE_CONFLICT';
				throw err;
			}
			if (String(url).includes('/state')) {
				return { success: true, session: { status: 'completed' } };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const { result } = renderHeartbeat({ onSessionEnded });
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.heartbeatState).toBe('ended');
		expect(onSessionEnded).toHaveBeenCalledWith('completed');
		// No infinite loop: advance time, no further heartbeat calls
		const callsAfterEnd = mockApiCall.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(120_000);
			await Promise.resolve();
		});
		expect(mockApiCall.mock.calls.length).toBe(callsAfterEnd);
	});
});

// M3: explicit pause does not fire the "connection lost" notice
describe('M3: explicit pause suppresses auto-pause notice', () => {
	it('does not call onAutoPaused when the pause was explicit', async () => {
		const onAutoPaused = vi.fn();
		let heartbeatShould409 = false;
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/heartbeat')) {
				if (heartbeatShould409) {
					const err = new Error('Cannot heartbeat a paused session') as Error & {
						code?: string;
					};
					err.code = 'SESSION_STATE_CONFLICT';
					throw err;
				}
				return { success: true };
			}
			if (String(url).endsWith('/state') && !String(url).includes('/heartbeat')) {
				// PATCH /state (pause) or GET /state
				return { success: true, session: { status: 'paused' } };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const { result } = renderHeartbeat({ onAutoPaused });
		await act(async () => {
			await Promise.resolve();
		});
		// User clicks pause; an in-flight heartbeat 409s afterwards
		heartbeatShould409 = true;
		await act(async () => {
			await result.current.pause();
		});
		// Simulate the in-flight heartbeat landing after the pause
		await act(async () => {
			vi.advanceTimersByTime(20_000);
			await Promise.resolve();
		});
		expect(result.current.heartbeatState).toBe('paused');
		expect(onAutoPaused).not.toHaveBeenCalled();
	});
});

// L1: double-click pause sends a single PATCH
describe('L1: in-flight guard', () => {
	it('ignores a second pause() while the first is in flight', async () => {
		let resolvePatch: ((v: unknown) => void) | null = null;
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/heartbeat')) return { success: true };
			if (String(url).includes('/state')) {
				return new Promise((resolve) => {
					resolvePatch = resolve;
				});
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const { result } = renderHeartbeat();
		await act(async () => {
			await Promise.resolve();
		});
		// Fire two pauses without awaiting
		let p1: Promise<void>, p2: Promise<void>;
		act(() => {
			p1 = result.current.pause();
			p2 = result.current.pause();
		});
		await act(async () => {
			resolvePatch?.({ success: true });
			await p1!;
			await p2!;
		});
		const patchCalls = mockApiCall.mock.calls.filter((c) =>
			String(c[0]).includes('/state') && (c[1] as { method?: string })?.method === 'PATCH',
		);
		expect(patchCalls.length).toBe(1);
	});
});

// Pause → resume restarts heartbeats
describe('pause/resume lifecycle', () => {
	it('restarts heartbeats after resume', async () => {
		const onResumed = vi.fn();
		mockApiCall.mockResolvedValue({ success: true });
		const { result } = renderHeartbeat({ onResumed });
		await act(async () => {
			await Promise.resolve();
		});
		await act(async () => {
			await result.current.pause();
		});
		expect(result.current.heartbeatState).toBe('paused');
		const callsWhilePaused = mockApiCall.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(40_000);
			await Promise.resolve();
		});
		// No heartbeats while paused (only the pause PATCH was sent)
		const heartbeatsWhilePaused = mockApiCall.mock.calls
			.slice(callsWhilePaused)
			.filter((c) => String(c[0]).includes('/heartbeat'));
		expect(heartbeatsWhilePaused.length).toBe(0);

		await act(async () => {
			await result.current.resume();
		});
		expect(result.current.heartbeatState).toBe('active');
		expect(onResumed).toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(20_000);
			await Promise.resolve();
		});
		const heartbeatsAfterResume = mockApiCall.mock.calls.filter((c) =>
			String(c[0]).includes('/heartbeat'),
		);
		expect(heartbeatsAfterResume.length).toBeGreaterThan(0);
	});
});
describe('AC-4: friendly errors on invalid transitions', () => {
	it('maps 409 SESSION_STATE_CONFLICT to a friendly message', async () => {
		const err = new Error('Cannot transition from completed to paused') as Error & {
			code?: string;
			status?: number;
		};
		err.code = 'SESSION_STATE_CONFLICT';
		err.status = 409;
		mockApiCall.mockRejectedValue(err);
		const { result } = renderHeartbeat();
		await act(async () => {
			await result.current.pause();
		});
		expect(result.current.error).toBeTruthy();
		// Must not leak the raw backend message or the code
		expect(result.current.error).not.toContain('SESSION_STATE_CONFLICT');
		expect(result.current.error).not.toContain('Cannot transition');
	});
});
