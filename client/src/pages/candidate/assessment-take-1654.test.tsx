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
