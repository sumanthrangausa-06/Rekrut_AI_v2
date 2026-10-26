/**
 * #1371 — Quick Practice video submit: the catch path must consume the
 * retry signal apiCall now preserves on THROWN errors (#1369).
 *
 * Root cause: a real 503 from submit-video THROWS through apiCall (it
 * never resolves), but doSubmit checked `retryable` only on the RESOLVED
 * value and its catch never read `err.retryable` — so the user-visible
 * auto-retry could never fire. Raised by the silent-failure-hunter as
 * MAJOR M1 in the #1365 / PR #1369 specialist review.
 *
 * Contract pinned here:
 * - attempt 1 throws { status: 503, retryable: true, retryAfterMs } →
 *   exactly ONE retry; if the retry succeeds, coaching renders and no
 *   error is shown; if the retry also fails, the honest error surfaces
 *   inline and there is no third attempt.
 * - a thrown error that is NOT (503 + retryable:true) → no retry.
 *
 * Scaffolding mirrors the #1357 video test: jsdom lacks canvas 2d and
 * SpeechRecognition, so both are stubbed at the browser-API boundary;
 * apiCall is mocked at the network boundary. These are regression pins;
 * they do NOT satisfy the Quinn E2E-on-dev gate (real-HTTP browser run
 * is attached to the issue separately).
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

const COACHING = {
	overall_score: 8,
	content: {
		score: 8,
		strengths: ['Clear structure'],
		improvements: ['Add metrics'],
		covered_points: [],
		missed_points: [],
		detailed_feedback: '',
		improved_response: '',
		specific_tips: [],
		common_mistake: '',
		practice_prompt: '',
	},
	communication: {
		score: 8,
		word_count: 20,
		words_per_minute: 120,
		duration_seconds: 10,
		filler_words: {},
		total_fillers: 0,
		filler_rate: 0,
		pace: { assessment: '', wpm: 120, feedback: '' },
		tips: [],
	},
	presentation: {
		score: 8,
		eye_contact: { score: 8, feedback: '' },
		facial_expressions: { score: 8, feedback: '' },
		body_language: { score: 8, feedback: '' },
		professional_appearance: { score: 8, feedback: '' },
		summary: '',
		timestamped_notes: [],
	},
};

/** The exact shape apiCall throws after #1369 for a server 503. */
function retryable503() {
	const err: any = new Error(
		'AI analysis is temporarily unavailable. Please try again in a moment.',
	);
	err.status = 503;
	err.retryable = true;
	err.retryAfterMs = 10; // tiny so the test does not actually wait 3s
	return err;
}

function submitCallCount() {
	return apiCallMock.mock.calls.filter((c) => c[0] === '/interviews/practice/submit-video').length;
}

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
	const videoBtn = await screen.findByText('Record Video');
	fireEvent.click(videoBtn.closest('button') as HTMLElement);
	const acceptBtn = await screen.findByText('Accept consent (test)');
	fireEvent.click(acceptBtn);
	const startBtn = await screen.findByRole('button', { name: /Start Recording/ });
	fireEvent.click(startBtn);
	const stopBtn = await screen.findByRole('button', { name: /Stop Recording/ }, { timeout: 8000 });
	recognitionInstance.emitFinal(LONG_TRANSCRIPT);
	fireEvent.click(stopBtn);
	return screen.getByRole('button', { name: /Get AI Coaching/ });
}

describe('#1371 Quick Practice video submit — thrown 503 retryable must auto-retry once', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recognitionInstance = null;
		vi.spyOn(window, 'alert').mockImplementation(() => {});
		(window as any).SpeechRecognition = FakeRecognition;
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,frame');
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			throw new Error(`unexpected apiCall in setup: ${url}`);
		});
	});

	test('thrown 503+retryable on attempt 1 retries once; retry success shows coaching, no error', async () => {
		let submits = 0;
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video') {
				submits++;
				if (submits === 1) throw retryable503();
				return { success: true, coaching: COACHING };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		await waitFor(() => expect(screen.getByText(/Overall Practice Score/)).toBeInTheDocument(), {
			timeout: 10000,
		});
		expect(submitCallCount()).toBe(2);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	}, 20000);

	test('thrown 503+retryable on both attempts: exactly 2 calls, honest error surfaced', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video') throw retryable503();
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		expect(await screen.findByRole('alert', {}, { timeout: 10000 })).toHaveTextContent(
			/temporarily unavailable/i,
		);
		// Give any (incorrect) further retry a chance to fire, then pin the count.
		await new Promise((r) => setTimeout(r, 300));
		expect(submitCallCount()).toBe(2);
	}, 20000);

	test('thrown 503 WITHOUT retryable does not retry', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video') {
				const err: any = new Error(
					'AI analysis is temporarily unavailable. Please try again in a moment.',
				);
				err.status = 503;
				throw err;
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderVideoModeReadyToSubmit();
		fireEvent.click(button);

		expect(await screen.findByRole('alert', {}, { timeout: 10000 })).toHaveTextContent(
			/temporarily unavailable/i,
		);
		await new Promise((r) => setTimeout(r, 300));
		expect(submitCallCount()).toBe(1);
	}, 20000);
});
