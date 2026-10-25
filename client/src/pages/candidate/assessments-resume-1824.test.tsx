/**
 * Issue #1824 — after Save & Exit, the Assessments list must offer a
 * Resume door for the saved in-progress session (the exit dialog
 * promises: "You can resume this test from the Assessments page").
 *
 * User-journey framing (Candidate Experience lens): a candidate saves
 * and exits a test, returns to the Assessments list, and sees a Resume
 * action on that topic's card — clicking it lands back in the same
 * session's take page. While a session is in progress the card must
 * NOT offer Configure & Start (starting would silently abandon the
 * saved session). A topic with no in-progress session keeps the
 * normal Configure & Start door and shows no Resume.
 *
 * apiCall is mocked at the network boundary (the repo's client-test
 * pattern). Regression pins only — NOT the HL-003 E2E-on-dev gate.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
	useNavigate: () => navigateMock,
}));

import { CandidateAssessmentsPage } from './assessments';

function catalogWith(resumable: { sessionId: number } | null) {
	return {
		subjects: [
			{
				id: 5,
				slug: 'sql',
				name: 'SQL',
				category: 'technical',
				icon: 'SQL',
				description: 'Queries',
				topics: [
					{
						id: 30,
						slug: 'general',
						name: 'SQL — General',
						description: 'SQL general',
						availability: {
							formats: {
								mcq: { easy: 6, medium: 10, hard: 0 },
								short_answer: { easy: 3, medium: 3, hard: 2 },
								mixed: { easy: 9, medium: 13, hard: 2 },
								coding: { easy: 0, medium: 0, hard: 0 },
							},
							maxCount: 25,
							available: true,
						},
						progress: null,
						resumable,
					},
				],
			},
		],
	};
}

function mockPageApis(catalog: unknown) {
	apiCallMock.mockImplementation(async (url: string) => {
		if (url === '/assessments/catalog') return catalog;
		if (url === '/assessments/results') return { results: [] };
		if (url === '/assessments/assigned') return { attempts: [] };
		if (url === '/assessments/available') return { skills: [] };
		throw new Error(`unexpected ${url}`);
	});
}

beforeEach(() => {
	apiCallMock.mockReset();
	navigateMock.mockReset();
	sessionStorage.clear();
});

describe('#1824 — Resume door on the Assessments list', () => {
	test('a saved in-progress session renders Resume (not Configure & Start) and navigates to the same session', async () => {
		mockPageApis(catalogWith({ sessionId: 555 }));
		render(<CandidateAssessmentsPage />);
		const resume = await screen.findByRole('button', { name: 'Resume' });
		expect(resume).toBeInTheDocument();
		expect(screen.getByText(/test in progress — resume where you left off/i)).toBeInTheDocument();
		// Starting a new attempt would abandon the saved session — the
		// card must not offer it while resumable exists.
		expect(screen.queryByRole('button', { name: /configure & start/i })).not.toBeInTheDocument();
		fireEvent.click(resume);
		expect(navigateMock).toHaveBeenCalledWith('/candidate/assessments/555/take');
	});

	test('no in-progress session: Configure & Start only, no Resume, no in-progress line', async () => {
		mockPageApis(catalogWith(null));
		render(<CandidateAssessmentsPage />);
		expect(
			await screen.findByRole('button', { name: /configure & start/i }),
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
		expect(screen.queryByText(/test in progress/i)).not.toBeInTheDocument();
	});
});
