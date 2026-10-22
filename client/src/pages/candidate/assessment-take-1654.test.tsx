/**
 * Issue #1654 — addendum (Candidate Experience / design-ux review):
 * GAP-3 (exactly ONE instructions block) and GAP-4 (completion labels
 * from response fields) on the take page.
 *
 * GAP-3: a session WITH a configuration snapshot (the server sends
 * format/difficultyBand on /session/:id/current for configured sessions,
 * routes/assessments.js in_progress branch; the configure flow also
 * stores the config in the sessionStorage hand-off) renders the
 * snapshot instructions block; a session WITHOUT one renders the
 * existing Phase B gate. Never both, never neither.
 *
 * GAP-4: completion labels come from response fields only —
 * partial:true → "X of Y answered", no pass/fail, no Verified badge;
 * passed (the SERVER's passed field, never reconstructed from score) →
 * "Passed", and "Passed · Verified ✓" ONLY when verifiedEligible ===
 * true (no merged server response sends that field today, so the
 * Verified string must not appear); failed → "Not passed" with NO raw
 * score text.
 *
 * apiCall is mocked at the network boundary and the exit-fullscreen
 * module is stubbed (jsdom has no fullscreen); regression pins only —
 * NOT the HL-003 E2E-on-dev gate.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
	useParams: () => ({ id: '555' }),
	useNavigate: () => navigateMock,
}));

vi.mock('@/components/assessments/exit-fullscreen', () => ({
	ExitDialog: () => null,
	FullscreenWarning: () => null,
	TimerStatusAnnouncer: () => null,
	useFullscreenPolicy: () => ({
		mode: 'fs',
		warningOpen: false,
		enterFullscreen: vi.fn(async () => {}),
		continueWithoutFullscreen: vi.fn(),
		returnToFullscreen: vi.fn(async () => {}),
		setLeavingIntentionally: vi.fn(),
	}),
}));

import { AssessmentTakePage } from './assessment-take';

const QUESTION = {
	id: 1,
	text: 'What does len() do?',
	type: 'multiple_choice',
	options: ['A', 'B'],
	timeLimit: 120,
	questionNumber: 1,
	totalQuestions: 25,
};

function mockCurrent(payload: Record<string, unknown>) {
	apiCallMock.mockImplementation(async (url: string) => {
		if (url === '/assessments/session/555/current') return payload;
		throw new Error(`unexpected ${url}`);
	});
}

beforeEach(() => {
	apiCallMock.mockReset();
	navigateMock.mockReset();
	sessionStorage.clear();
});

describe('GAP-3 — exactly one instructions block', () => {
	test('snapshot session (via /current format fields): snapshot block renders, Phase B gate does not', async () => {
		mockCurrent({
			status: 'in_progress',
			skillName: 'Python',
			question: QUESTION,
			format: 'mcq',
			difficultyBand: 'hard',
			currentDraft: null,
			fullscreenExitsUsed: 0,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.getByText(/Multiple choice/)).toBeInTheDocument();
		expect(screen.getByText(/within the Hard band only/)).toBeInTheDocument();
		// The Phase B gate's distinctive count-line wording must NOT also render.
		expect(screen.queryByText(/This test has/)).not.toBeInTheDocument();
	});

	test('snapshot session (via the sessionStorage hand-off): snapshot block renders, no /current call needed', async () => {
		// #1679 item 9: pin the configure → take hand-off — the take page
		// must render the snapshot block from stored.config alone.
		sessionStorage.setItem(
			'assessment_555',
			JSON.stringify({
				question: QUESTION,
				skillName: 'Python',
				config: { format: 'mcq', difficultyBand: 'hard', totalQuestions: 25 },
			}),
		);
		apiCallMock.mockImplementation(async (url: string) => {
			throw new Error(`unexpected ${url}`);
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.getByText(/Multiple choice/)).toBeInTheDocument();
		expect(screen.getByText(/within the Hard band only/)).toBeInTheDocument();
		expect(screen.queryByText(/This test has/)).not.toBeInTheDocument();
		expect(apiCallMock).not.toHaveBeenCalledWith(
			'/assessments/session/555/current',
			expect.anything(),
		);
	});

	test('legacy session (no snapshot): Phase B gate renders, snapshot block does not', async () => {
		mockCurrent({
			status: 'in_progress',
			skillName: 'Python',
			question: QUESTION,
			format: null,
			difficultyBand: null,
			currentDraft: null,
			fullscreenExitsUsed: 0,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/This test has/)).toBeInTheDocument();
		expect(screen.queryByText(/Your configuration/)).not.toBeInTheDocument();
	});
});

describe('#1689 — take-page AI disclosure gated on format + format labels match configure', () => {
	const DISCLOSURE = /Short answers are scored by AI and reviewed by a human/;

	function mockSnapshot(format: string) {
		mockCurrent({
			status: 'in_progress',
			skillName: 'Python',
			question: QUESTION,
			format,
			difficultyBand: 'medium',
			currentDraft: null,
			fullscreenExitsUsed: 0,
		});
	}

	test('MCQ-only snapshot: no AI-scoring disclosure rendered', async () => {
		mockSnapshot('mcq');
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.queryByText(DISCLOSURE)).not.toBeInTheDocument();
	});

	test('mixed snapshot: AI-scoring disclosure rendered', async () => {
		mockSnapshot('mixed');
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
	});

	test('short_answer snapshot: AI-scoring disclosure rendered', async () => {
		mockSnapshot('short_answer');
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
	});

	// Format labels must match assessment-configure.tsx FORMATS verbatim
	// (spec §0.2 wording fixed in #1679).
	test.each([
		['mcq', 'Multiple choice'],
		['mixed', 'Mixed — multiple choice and written answers'],
		['short_answer', 'Written answers'],
		['coding', 'Coding'],
	])('format label for %s matches configure wording: %s', async (format, label) => {
		mockSnapshot(format);
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Your configuration/)).toBeInTheDocument();
		expect(screen.getByText(label)).toBeInTheDocument();
	});
});

describe('GAP-4 — completion labels from response fields', () => {
	test('partial: "X of Y answered", no pass/fail language, no Verified badge', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: null,
			passed: false,
			partial: true,
			answersGiven: 7,
			totalQuestions: 25,
			correctCount: 5,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 3,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText(/Partial — answered 7 of 25/)).toBeInTheDocument();
		expect(screen.queryByText(/PASSED|Passed · Verified/)).not.toBeInTheDocument();
	});

	test('passed without verifiedEligible: "Passed" only — no Verified string, pass NOT reconstructed from score', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: 88,
			passed: true,
			partial: false,
			answersGiven: 25,
			totalQuestions: 25,
			correctCount: 22,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 4,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText('Passed')).toBeInTheDocument();
		expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
	});

	test('passed with verifiedEligible === true: "Passed · Verified ✓"', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: 88,
			passed: true,
			verifiedEligible: true,
			partial: false,
			answersGiven: 25,
			totalQuestions: 25,
			correctCount: 22,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 4,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText('Passed · Verified ✓')).toBeInTheDocument();
	});

	test('discriminator (#1679 item 9): passed:false with score 88 is still "Not passed" — pass never comes from the score', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: 88,
			passed: false,
			partial: false,
			answersGiven: 25,
			totalQuestions: 25,
			correctCount: 22,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 4,
		});
		render(<AssessmentTakePage />);
		// A score-derived implementation (>= 60) would call this a pass.
		expect(await screen.findByText('Not passed')).toBeInTheDocument();
		expect(screen.queryByText('Passed')).not.toBeInTheDocument();
		expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
		expect(screen.queryByText('88')).not.toBeInTheDocument();
	});

	test('discriminator (#1679 item 9): passed:true with score 42 is still "Passed" — a low score never overrides the server field', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: 42,
			passed: true,
			partial: false,
			answersGiven: 25,
			totalQuestions: 25,
			correctCount: 10,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 2,
		});
		render(<AssessmentTakePage />);
		// A score-derived implementation would call this a fail and hide
		// the score; the server's passed field governs both.
		expect(await screen.findByText('Passed')).toBeInTheDocument();
		expect(screen.getByText('42')).toBeInTheDocument();
	});

	test('failed: "Not passed" and NO raw score text, even though a score value arrived', async () => {
		mockCurrent({
			status: 'completed',
			skillName: 'Python',
			score: 42,
			passed: false,
			partial: false,
			answersGiven: 25,
			totalQuestions: 25,
			correctCount: 9,
			antiCheatScore: null,
			durationSeconds: 300,
			maxDifficultyReached: 2,
		});
		render(<AssessmentTakePage />);
		expect(await screen.findByText('Not passed')).toBeInTheDocument();
		expect(screen.queryByText('42')).not.toBeInTheDocument();
		expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
	});
});
