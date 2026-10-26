/**
 * #1357 — Quick Practice video mode: submit failures must be visible.
 *
 * submitVideoResponse had a silent branch: a resolved response with
 * !success (and no retryable flag) returned from doSubmit with no alert,
 * no inline error, no state change — the click rendered as a no-op, the
 * same latent class #1352 fixed for text mode. Thrown errors were shown
 * only via alert(). These tests pin: a video submit produces coaching OR
 * a visible inline role="alert" error — never silence.
 *
 * Scaffolding note: jsdom lacks canvas 2d and SpeechRecognition, so both
 * are stubbed at the browser-API boundary (frame capture + dictation).
 * apiCall is mocked at the network boundary. These are regression pins;
 * they do NOT satisfy the Quinn E2E-on-dev gate.
 *
 * Shape note (reviewer, #1357): in production apiCall THROWS on a real
 * HTTP 503, so the thrown-error test is the live display path; the
 * resolved success:false test pins the resolved branch of doSubmit,
 * which must also never be silent if a response shape changes.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

vi.mock('react-router-dom', () => ({
	useParams: () => ({ questionId: 'beh-1' }),
	useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useInterviewCamera', () => ({
	useInterviewCamera: () => ({
		cameraReady: true,
		cameraError: null,
		cameraStatus: 'ready',
		micActive: false,
		startCamera: vi.fn(),
		stopCamera: vi.fn(),
		getStream: () => ({ getAudioTracks: () => [] }),
	}),
}));

vi.mock('@/components/QPBiometricConsent', () => ({
	QPBiometricConsent: ({ onAccepted }: { onAccepted: () => void }) => (
		<button type="button" onClick={onAccepted}>
			Accept consent (test)
		</button>
	),
}));

import { QuickPracticeSessionPage } from './quick-practice-session';

const QUESTION = {
	id: 'beh-1',
	category: 'behavioral',
	difficulty: 'Medium',
	question: 'Tell me about a time when you had to deal with a difficult team member.',
	key_points: ['Conflict resolution'],
};

const LONG_TRANSCRIPT =
	'In my previous role I led a migration that was failing badly and I delivered it two weeks early';

let recognitionInstance: any = null;
class FakeRecognition {
	continuous = false;
	interimResults = false;
	lang = '';
	onresult: any = null;
	onerror: any = null;
	onend: any = null;
	constructor() {
		recognitionInstance = this;
	}
	start() {}
	stop() {}
	emitFinal(transcript: string) {
		const result: any = [{ transcript }];
		result.isFinal = true;
		this.onresult({ resultIndex: 0, results: [result] });
	}
}

async function renderVideoModeReadyToSubmit() {
	render(<QuickPracticeSessionPage />);
	// Pick video mode → session/start → consent → accept → video mode.
	const videoBtn = await screen.findByText('Record Video');
	fireEvent.click(videoBtn.closest('button') as HTMLElement);
	const acceptBtn = await screen.findByText('Accept consent (test)');
	fireEvent.click(acceptBtn);
	// Start recording (3s countdown), then stop → recordingDone.
	const startBtn = await screen.findByRole('button', { name: /Start Recording/ });
	fireEvent.click(startBtn);
	const stopBtn = await screen.findByRole('button', { name: /Stop Recording/ }, { timeout: 8000 });
	recognitionInstance.emitFinal(LONG_TRANSCRIPT);
	fireEvent.click(stopBtn);
	return screen.getByRole('button', { name: /Get AI Coaching/ });
}

describe('#1357 Quick Practice video submit — result or visible error, never silence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recognitionInstance = null;
		vi.spyOn(window, 'alert').mockImplementation(() => {});
		(window as any).SpeechRecognition = FakeRecognition;
		// jsdom canvas has no 2d context / encoder — stub the browser boundary
		// so captureFrame() yields a frame, as a real browser would.
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,frame');
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			throw new Error(`unexpected apiCall in setup: ${url}`);
		});
	});

	test('resolved success:false shows a visible inline error (was: silent no-op)', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video')
				return {
					success: false,
					error: 'AI analysis is temporarily unavailable. Please try again in a moment.',
				};
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
	}, 20000);

	test('thrown 503 error shows its truthful message inline, not only alert()', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video')
				throw new Error('AI analysis is temporarily unavailable. Please try again in a moment.');
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
		expect(window.alert).not.toHaveBeenCalled();
	}, 20000);

	test('resolved success:true without coaching shows a visible inline error', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video') return { success: true };
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(/could not get AI coaching/i);
	}, 20000);
});
