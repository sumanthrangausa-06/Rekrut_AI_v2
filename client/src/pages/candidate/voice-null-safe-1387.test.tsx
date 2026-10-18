/**
 * #1387 — Voice dimension renders must use the null-safe coaching-utils
 * helpers (formatScore / scoreColorSafe / scoreBgSafe).
 *
 * After the #1377 voice-clamp fix, analyzeVoiceQuality can return a voice
 * dimension whose score is null. The three pages below rendered voice
 * dimensions with the UNSAFE helpers (scoreColor / scoreBg / raw
 * `{data.score}/10`), so a null dimension showed as a bare "/10" with
 * red styling — misleading (reads as a failing score instead of "no data").
 *
 * These tests render the REAL pages with a null voice dimension and pin
 * the correct behaviour: "N/A" in muted styling, no bare "/10", no red
 * card — while a real score still renders normally ("8/10", green).
 *
 * NOTE: apiCall is mocked at the network boundary for the Quick Practice
 * flow (unit / regression pins). The E2E-on-dev gate is evidenced
 * separately in the #1387 run folder.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { HistoryTab } from './ai-coaching-progress';
import { formatScore, scoreBgSafe, scoreColorSafe } from './coaching-utils';
import { InterviewResultsPage } from './interview-results-page';
import { QuickPracticeSessionPage } from './quick-practice-session';

// ---------------------------------------------------------------- fixtures

const dim = (score: number | null, feedback = 'feedback') => ({ score, feedback });

function voiceAnalysis(confidenceScore: number | null) {
	return {
		voice_confidence: dim(confidenceScore, 'Confidence feedback'),
		vocal_variety: dim(8, 'Variety feedback'),
		articulation: dim(8, 'Articulation feedback'),
		energy: dim(8, 'Energy feedback'),
		overall_voice_score: 8,
		voice_summary: 'Voice summary',
		voice_tips: [] as string[],
	};
}

const categoryDetail = (score: number) => ({ score, feedback: 'ok' });

function videoCoaching(confidenceScore: number | null) {
	return {
		overall_score: 7,
		content: {
			score: 7,
			strengths: ['Clear structure'],
			improvements: ['Add metrics'],
			covered_points: [] as string[],
			missed_points: [] as string[],
			detailed_feedback: 'Detailed feedback',
			improved_response: 'Improved response',
			specific_tips: [] as string[],
			common_mistake: 'None',
			practice_prompt: 'Practice',
			star_method_usage: dim(7),
			technical_depth: dim(7),
		},
		communication: {
			score: 7,
			word_count: 120,
			words_per_minute: 130,
			duration_seconds: 55,
			filler_words: {} as Record<string, number>,
			total_fillers: 0,
			filler_rate: 0,
			pace: { assessment: 'good', wpm: 130, feedback: 'Good pace' },
			tips: [] as string[],
			voice_analysis: voiceAnalysis(confidenceScore),
		},
		presentation: {
			score: 8,
			eye_contact: categoryDetail(8),
			facial_expressions: categoryDetail(8),
			body_language: categoryDetail(8),
			professional_appearance: categoryDetail(8),
			summary: 'Presentation summary',
			timestamped_notes: [] as { frame: number; note: string }[],
		},
	};
}

function mockFeedback(confidenceScore: number | null) {
	return {
		overall_score: 7,
		interview_readiness: 'Ready',
		summary: 'Summary',
		strengths: ['Strength'],
		improvements: ['Improvement'],
		question_scores: [{ question_summary: 'Q1', score: 7, feedback: 'ok' }],
		star_method_usage: dim(7),
		communication_quality: dim(7),
		technical_depth: dim(7),
		top_tip: 'Top tip',
		content: {
			score: 7,
			detailed_feedback: 'Detailed feedback',
			strengths: [] as string[],
			improvements: [] as string[],
			covered_points: [] as string[],
			missed_points: [] as string[],
			specific_tips: [] as string[],
			star_method_usage: dim(7),
			technical_depth: dim(7),
		},
		communication: {
			score: 7,
			word_count: 120,
			words_per_minute: 130,
			duration_seconds: 55,
			filler_words: {} as Record<string, number>,
			total_fillers: 0,
			filler_rate: 0,
			pace: { assessment: 'good', wpm: 130, feedback: 'Good pace' },
			tips: [] as string[],
			voice_analysis: voiceAnalysis(confidenceScore),
		},
		presentation: {
			score: 8,
			eye_contact: categoryDetail(8),
			facial_expressions: categoryDetail(8),
			body_language: categoryDetail(8),
			professional_appearance: categoryDetail(8),
			summary: 'Presentation summary',
		},
		voice_analysis: voiceAnalysis(confidenceScore),
	};
}

const mockSessionProp = {
	id: 1,
	target_role: 'Engineer',
	job_description: null,
	status: 'completed' as const,
	conversation: [],
	current_question_index: 0,
	overall_score: 7,
	overall_feedback: null,
	questions_asked: 1,
	follow_ups_asked: 0,
	started_at: '2026-10-01T10:00:00Z',
	completed_at: '2026-10-01T10:10:00Z',
};

// ---------------------------------------------------------------- helpers

function cardOf(el: HTMLElement): HTMLElement {
	let node: HTMLElement | null = el;
	while (node && !(node.className?.includes('p-2.5') && node.className?.includes('border'))) {
		node = node.parentElement;
	}
	return node as HTMLElement;
}

/** The voice card for `label` must render the null state honestly. */
function expectNullVoiceCard(label: string) {
	const labelEl = screen.getByText(label, { selector: 'span' });
	const card = cardOf(labelEl);
	expect(card, `voice card for ${label}`).toBeTruthy();
	// No bare "/10" anywhere in the card, and the score reads "N/A".
	expect(card.textContent).not.toContain('/10');
	const na = within(card).getByText('N/A');
	expect(na.className).toContain('text-muted-foreground');
	expect(na.className).not.toContain('text-red-600');
	// Card itself must not carry the red "failing" background.
	expect(card.className).not.toContain('bg-red-50');
	expect(card.className).not.toContain('border-red-200');
}

/** A real voice score in the same grid still renders normally. */
function expectRealVoiceCard(label: string) {
	const labelEl = screen.getByText(label, { selector: 'span' });
	const card = cardOf(labelEl);
	const score = within(card).getByText('8/10');
	expect(score.className).toContain('text-green-600');
}

// ---------------------------------------------------------------- tests

describe('coaching-utils null-safe helpers (contract)', () => {
	test('null renders as N/A with neutral styling', () => {
		expect(formatScore(null)).toBe('N/A');
		expect(formatScore(undefined)).toBe('N/A');
		expect(scoreColorSafe(null)).toBe('text-muted-foreground');
		expect(scoreBgSafe(null)).toBe('bg-muted/40 border-muted');
		expect(formatScore(8)).toBe('8/10');
		expect(scoreColorSafe(8)).toBe('text-green-600');
	});
});

describe('#1387 interview-results-page voice block', () => {
	async function renderAndExpand(confidenceScore: number | null) {
		render(
			<InterviewResultsPage
				mockSession={mockSessionProp as any}
				mockFeedback={mockFeedback(confidenceScore) as any}
				viewingHistorySession={false}
				onBack={vi.fn()}
				onNewInterview={vi.fn()}
			/>,
		);
		const header = await screen.findByText('Communication & Speech');
		fireEvent.click(header.closest('button') as HTMLElement);
		await screen.findByText('Voice & Tone Analysis');
	}

	test('null voice dimension → N/A muted, no bare /10, no red card', async () => {
		await renderAndExpand(null);
		expectNullVoiceCard('Confidence');
		expectRealVoiceCard('Vocal Variety');
		expect(screen.queryByText('/10')).not.toBeInTheDocument();
	});

	test('real voice scores still render normally (control)', async () => {
		await renderAndExpand(8);
		expectRealVoiceCard('Confidence');
		expect(screen.queryByText('/10')).not.toBeInTheDocument();
	});
});

describe('#1387 ai-coaching-progress voice blocks', () => {
	function historySession(overrides: Record<string, unknown>) {
		return {
			id: 1,
			question_id: 'beh-1',
			question: 'Tell me about a difficult team member.',
			category: 'behavioral',
			response_text: 'My response',
			score: 7,
			coaching_data: null,
			response_type: 'video',
			transcription: null,
			audio_analysis: null,
			video_analysis: null,
			duration_seconds: 60,
			created_at: '2026-10-01T10:00:00Z',
			...overrides,
		};
	}

	async function openReviewAndExpandCommunication(session: any) {
		render(
			<HistoryTab
				historySessions={[session]}
				historyTotal={1}
				historyLoading={false}
				historyFilter="all"
				onFilterChange={vi.fn()}
			/>,
		);
		fireEvent.click(await screen.findByText(session.question));
		const header = await screen.findByText('Communication & Speech');
		fireEvent.click(header.closest('button') as HTMLElement);
		await screen.findByText(/Voice & Tone/);
	}

	test('video session (cd.communication.voice_analysis): null → N/A muted', async () => {
		await openReviewAndExpandCommunication(
			historySession({ coaching_data: videoCoaching(null) }),
		);
		expectNullVoiceCard('Confidence');
		expectRealVoiceCard('Vocal Variety');
	});

	test('mock session (cd.voice_analysis): null → N/A muted', async () => {
		await openReviewAndExpandCommunication(
			historySession({
				question_id: 'mock-1',
				response_type: null,
				coaching_data: mockFeedback(null),
			}),
		);
		expectNullVoiceCard('Confidence');
		expectRealVoiceCard('Vocal Variety');
	});

	test('video session control: real scores render normally', async () => {
		await openReviewAndExpandCommunication(
			historySession({ coaching_data: videoCoaching(8) }),
		);
		expectRealVoiceCard('Confidence');
	});
});

describe('#1387 quick-practice-session voice block', () => {
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

	beforeEach(() => {
		vi.clearAllMocks();
		recognitionInstance = null;
		vi.spyOn(window, 'alert').mockImplementation(() => {});
		(window as any).SpeechRecognition = FakeRecognition;
		HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as any;
		HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,frame');
	});

	async function renderVideoCoaching(confidenceScore: number | null) {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/session/start') return { sessionId: 123 };
			if (url === '/interviews/practice/submit-video')
				return { success: true, coaching: videoCoaching(confidenceScore) };
			throw new Error(`unexpected apiCall: ${url}`);
		});
		render(<QuickPracticeSessionPage />);
		const videoBtn = await screen.findByText('Record Video');
		fireEvent.click(videoBtn.closest('button') as HTMLElement);
		fireEvent.click(await screen.findByText('Accept consent (test)'));
		fireEvent.click(await screen.findByRole('button', { name: /Start Recording/ }));
		const stopBtn = await screen.findByRole(
			'button',
			{ name: /Stop Recording/ },
			{ timeout: 8000 },
		);
		recognitionInstance.emitFinal(LONG_TRANSCRIPT);
		fireEvent.click(stopBtn);
		fireEvent.click(screen.getByRole('button', { name: /Get AI Coaching/ }));
		const header = await screen.findByText('Communication & Speech');
		fireEvent.click(header.closest('button') as HTMLElement);
		await screen.findByText('Voice & Tone Analysis');
	}

	test('null voice dimension → N/A muted, no bare /10, no red card', async () => {
		await renderVideoCoaching(null);
		expectNullVoiceCard('Confidence');
		expectRealVoiceCard('Vocal Variety');
		expect(screen.queryByText('/10')).not.toBeInTheDocument();
	}, 30000);

	test('real voice scores still render normally (control)', async () => {
		await renderVideoCoaching(8);
		expectRealVoiceCard('Confidence');
		expect(screen.queryByText('/10')).not.toBeInTheDocument();
	}, 30000);
});
