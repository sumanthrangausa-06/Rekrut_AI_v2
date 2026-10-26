/**
 * #1378 — Quick Practice video submit: clamp err.retryAfterMs before it
 * reaches setTimeout (follow-up LOW L1 from the #1371 specialist review).
 *
 * Before this fix, the consumption site was:
 *   retryDelayMs = typeof err.retryAfterMs === 'number' ? err.retryAfterMs : 3000
 * `typeof NaN === 'number'`, so a NaN / negative / huge retryAfterMs passed
 * straight to setTimeout: NaN fires immediately, a huge value (e.g. a
 * server-sent 3_600_000) would stall the single auto-retry for an hour.
 *
 * Contract pinned here (clamp range 0–15000ms, fallback 3000):
 * - NaN        → 3000 (fallback)
 * - negative   → 0 (clamped to floor)
 * - 3_600_000  → 15000 (clamped to cap)
 * - 5000       → 5000 (valid value unchanged)
 *
 * Method: spy on the global setTimeout and record every requested delay.
 * Only the retry-path delay under test is accelerated (scheduled at 0ms)
 * so the flow completes; all other timers run untouched. The assertion is
 * on the delay the component actually requested — the exact value that
 * would have governed the real wait.
 *
 * Scaffolding mirrors the #1371 test: jsdom lacks canvas 2d and
 * SpeechRecognition, so both are stubbed at the browser-API boundary;
 * apiCall is mocked at the network boundary. These are regression pins;
 * they do NOT satisfy the Quinn E2E-on-dev gate — see #1378 for why the
 * proportionate form applies (client-side timing only, first-party route
 * hardcodes retryAfterMs: 3000, existing #1371 E2E contract stands).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

// --- setTimeout delay capture -------------------------------------------------
const realSetTimeout = globalThis.setTimeout;
let requestedDelays: number[] = [];
let accelerateIf: (delay: number) => boolean = () => false;

function installDelayCapture() {
	requestedDelays = [];
	vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: any, delay?: any, ...rest: any[]) => {
		if (typeof delay === 'number' || delay === undefined) {
			const d = delay as number;
			requestedDelays.push(d);
			if (accelerateIf(d)) return realSetTimeout(cb, 0, ...rest);
		}
		return realSetTimeout(cb, delay, ...rest);
	}) as any);
}

function retryable503With(retryAfterMs: unknown) {
	const err: any = new Error(
		'AI analysis is temporarily unavailable. Please try again in a moment.',
	);
	err.status = 503;
	err.retryable = true;
	err.retryAfterMs = retryAfterMs;
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

describe('#1378 Quick Practice retry — retryAfterMs is clamped before setTimeout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recognitionInstance = null;
		accelerateIf = () => false;
		vi.spyOn(window, 'alert').mockImplementation(() => {});
		(window as any).SpeechRecognition = FakeRecognition;
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,frame');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function runRetryCase(rawRetryAfterMs: unknown, accelerate: (d: number) => boolean) {
		accelerateIf = accelerate;
		installDelayCapture();
		let submits = 0;
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video') {
				submits++;
				if (submits === 1) throw retryable503With(rawRetryAfterMs);
				return { success: true, coaching: COACHING };
			}
			throw new Error(`unexpected apiCall: ${url}`);
		});
		const button = await renderVideoModeReadyToSubmit();
		// Capture only delays requested from the submit click onward.
		requestedDelays = [];
		fireEvent.click(button);
		await waitFor(() => expect(screen.getByText(/Overall Practice Score/)).toBeInTheDocument(), {
			timeout: 10000,
		});
		expect(submitCallCount()).toBe(2);
		return requestedDelays;
	}

	test('NaN retryAfterMs falls back to 3000ms', async () => {
		const delays = await runRetryCase(Number.NaN, (d) => Number.isNaN(d) || d === 3000);
		expect(delays.some((d) => Number.isNaN(d))).toBe(false);
		expect(delays).toContain(3000);
	}, 20000);

	test('negative retryAfterMs is clamped to 0ms', async () => {
		const delays = await runRetryCase(-5000, (d) => d === -5000 || d === 0);
		expect(delays).not.toContain(-5000);
		expect(delays).toContain(0);
	}, 20000);

	test('huge retryAfterMs (3_600_000) is capped at 15000ms', async () => {
		const delays = await runRetryCase(3_600_000, (d) => d === 3_600_000 || d === 15000);
		expect(delays).not.toContain(3_600_000);
		expect(delays).toContain(15000);
	}, 20000);

	test('valid retryAfterMs (5000) passes through unchanged', async () => {
		const delays = await runRetryCase(5000, (d) => d === 5000);
		expect(delays).toContain(5000);
		expect(delays).not.toContain(3000);
	}, 20000);

	test('Infinity retryAfterMs falls back to 3000ms (non-finite is garbage, not a cap hit)', async () => {
		const delays = await runRetryCase(Infinity, (d) => d === Infinity || d === 3000);
		expect(delays).not.toContain(Infinity);
		expect(delays).toContain(3000);
	}, 20000);

	test('retryAfterMs just above the cap (15001) is clamped to 15000ms', async () => {
		const delays = await runRetryCase(15001, (d) => d === 15001 || d === 15000);
		expect(delays).not.toContain(15001);
		expect(delays).toContain(15000);
	}, 20000);
});
