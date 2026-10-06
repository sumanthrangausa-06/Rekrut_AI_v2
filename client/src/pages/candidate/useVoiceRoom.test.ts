/**
 * Task 4 (#323) — useVoiceRoom hook: Track A voice join for the session page.
 *
 * livekit-client is mocked (no network in vitest); apiCall is mocked.
 * The hook under test does not exist yet — these tests define its contract.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ─── livekit-client mock ────────────────────────────────────────────────────
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const setMicrophoneEnabledMock = vi.fn();
const setCameraEnabledMock = vi.fn();
const roomOnMock = vi.fn();

vi.mock('livekit-client', () => {
	class MockRoom {
		connect = connectMock;
		disconnect = disconnectMock;
		on = roomOnMock;
		localParticipant = {
			setMicrophoneEnabled: setMicrophoneEnabledMock,
			setCameraEnabled: setCameraEnabledMock,
		};
	}
	return {
		Room: MockRoom,
		RoomEvent: {
			Connected: 'connected',
			Disconnected: 'disconnected',
			TrackSubscribed: 'trackSubscribed',
		},
		Track: { Kind: { Audio: 'audio', Video: 'video' } },
	};
});

// ─── apiCall mock ───────────────────────────────────────────────────────────
const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

import { useVoiceRoom } from './useVoiceRoom';

const TOKEN_RESPONSE = {
	token: 'mock-livekit-jwt',
	roomName: 'interview-42',
	livekitUrl: 'wss://test.livekit.cloud',
};

function setupFetch() {
	apiCallMock.mockImplementation(async (url: string) => {
		if (url === '/livekit/session-rooms/42/token') return TOKEN_RESPONSE;
		if (url === '/livekit/session-rooms/42/dispatch') return { success: true, dispatched: true };
		if (url === '/livekit/session-rooms/42/transcript')
			return { success: true, conversation: [] };
		throw new Error(`unexpected apiCall: ${url}`);
	});
}

const baseOpts = {
	sessionId: 42,
	candidateName: 'Cand',
	videoEnabled: true,
	onTranscript: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	setupFetch();
	Object.defineProperty(window.navigator, 'mediaDevices', {
		value: { getUserMedia: vi.fn(async () => ({})) },
		configurable: true,
	});
});

describe('useVoiceRoom', () => {
	test('start() requests a token and connects the room to interview-42', async () => {
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		expect(result.current.voiceState).toBe('idle');
		await act(async () => {
			await result.current.start();
		});

		expect(apiCallMock).toHaveBeenCalledWith('/livekit/session-rooms/42/token', {
			method: 'POST',
			body: { name: 'Cand' },
		});
		expect(connectMock).toHaveBeenCalledWith('wss://test.livekit.cloud', 'mock-livekit-jwt');
		expect(setMicrophoneEnabledMock).toHaveBeenCalledWith(true);
		expect(setCameraEnabledMock).toHaveBeenCalledWith(true);
		expect(result.current.voiceState).toBe('live');
	});

	test('dispatch is fire-and-forget: failure is silent, voice still goes live', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/livekit/session-rooms/42/token') return TOKEN_RESPONSE;
			if (url === '/livekit/session-rooms/42/dispatch') throw new Error('dispatch exploded');
			return { success: true, conversation: [] };
		});
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});

		expect(apiCallMock).toHaveBeenCalledWith('/livekit/session-rooms/42/dispatch', {
			method: 'POST',
			body: { mode: 'interviewer' },
		});
		expect(connectMock).toHaveBeenCalled();
		expect(result.current.voiceState).toBe('live');
	});

	test('double start() issues a single token request (double-click guard)', async () => {
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await Promise.all([result.current.start(), result.current.start()]);
		});

		const tokenCalls = apiCallMock.mock.calls.filter(
			([url]) => url === '/livekit/session-rooms/42/token',
		);
		expect(tokenCalls).toHaveLength(1);
		expect(connectMock).toHaveBeenCalledTimes(1);
	});

	test('token failure falls back without creating a room', async () => {
		apiCallMock.mockRejectedValueOnce(new Error('503 LiveKit not configured'));
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.voiceState).toBe('fallback');
		expect(connectMock).not.toHaveBeenCalled();
	});

	test('room connect failure falls back', async () => {
		connectMock.mockRejectedValueOnce(new Error('connection timeout'));
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.voiceState).toBe('fallback');
	});

	test('no WebRTC support falls back immediately without a token request', async () => {
		Object.defineProperty(window.navigator, 'mediaDevices', {
			value: undefined,
			configurable: true,
		});
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.voiceState).toBe('fallback');
		expect(apiCallMock).not.toHaveBeenCalled();
	});

	test('while live, transcript polling delivers new turns via onTranscript', async () => {
		const onTranscript = vi.fn();
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/livekit/session-rooms/42/token') return TOKEN_RESPONSE;
			if (url === '/livekit/session-rooms/42/dispatch') return { success: true };
			if (url === '/livekit/session-rooms/42/transcript')
				return {
					success: true,
					conversation: [{ role: 'interviewer', text: 'Tell me about yourself' }],
				};
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const { result } = renderHook(() => useVoiceRoom({ ...baseOpts, onTranscript }));

		await act(async () => {
			await result.current.start();
		});
		await act(async () => {
			vi.advanceTimersByTime(3000);
		});

		expect(onTranscript).toHaveBeenCalledWith([
			{ role: 'interviewer', text: 'Tell me about yourself' },
		]);
	});

	test('stop() disconnects the room and stops polling', async () => {
		const onTranscript = vi.fn();
		const { result } = renderHook(() => useVoiceRoom({ ...baseOpts, onTranscript }));

		await act(async () => {
			await result.current.start();
		});
		act(() => {
			result.current.stop();
		});

		expect(disconnectMock).toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(10000);
		});
		expect(onTranscript).not.toHaveBeenCalled();
	});

	test('attaches the agent audio track so the candidate hears the interviewer', async () => {		const playMock = vi.fn(async () => {});
		const attachMock = vi.fn(() => ({ play: playMock }));
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});

		const trackHandler = roomOnMock.mock.calls.find(([ev]) => ev === 'trackSubscribed')?.[1];
		expect(trackHandler).toBeDefined();
		act(() => {
			trackHandler({ kind: 'audio', attach: attachMock }, {});
		});
		expect(attachMock).toHaveBeenCalled();
		expect(playMock).toHaveBeenCalled();
	});

	// Full-branch review C1 (#323): for human interviews the candidate joins
	// the room but no AI interviewer is dispatched.
	test('dispatchMode: null skips dispatch but still joins the room', async () => {
		const { result } = renderHook(() => useVoiceRoom({ ...baseOpts, dispatchMode: null }));

		await act(async () => {
			await result.current.start();
		});

		const dispatchCalls = apiCallMock.mock.calls.filter(
			([url]) => url === '/livekit/session-rooms/42/dispatch',
		);
		expect(dispatchCalls).toHaveLength(0);
		expect(apiCallMock).toHaveBeenCalledWith('/livekit/session-rooms/42/token', {
			method: 'POST',
			body: { name: 'Cand' },
		});
		expect(connectMock).toHaveBeenCalled();
		expect(result.current.voiceState).toBe('live');
	});

	test('setVideoEnabled(false) disables the room camera (consent withdrawal)', async () => {
		const { result } = renderHook(() => useVoiceRoom(baseOpts));

		await act(async () => {
			await result.current.start();
		});
		expect(setCameraEnabledMock).toHaveBeenCalledWith(true);

		await act(async () => {
			await result.current.setVideoEnabled(false);
		});
		expect(setCameraEnabledMock).toHaveBeenCalledWith(false);
	});
});
