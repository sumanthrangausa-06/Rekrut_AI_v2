/**
 * Issue #1654 — #1603 Phase C story C2 (CLIENT): configuration +
 * instructions screens. Journey tests JT-C1 / JT-C4 (PRD §10), written
 * from the candidate's expectations:
 *
 *  JT-C1: Candidate chooses a subject → a topic → a format → a count and
 *  difficulty → the pre-flight shows exactly what will be served → the
 *  instructions show exactly that configuration → Start posts exactly
 *  that configuration body to POST /assessments/start.
 *  JT-C4: Choosing a configuration the bank cannot serve shows the honest
 *  state BEFORE start — the server's reason verbatim, the smaller count
 *  offered ONLY as a labelled choice the candidate explicitly accepts,
 *  and zero supply renders an honest empty state with no start action.
 *  A 503 at start keeps the Phase A contract: the saved session is
 *  resumable and the extended { promised, largestAvailable } fields are
 *  surfaced, never silently substituted.
 *
 * apiCall is mocked at the network boundary (the repo's client-test
 * pattern); payloads and response handling are the REAL merged C1/C2
 * server contracts (routes/assessments.js @ dev 892b5a81f). These are
 * regression pins — they do NOT satisfy the HL-003 E2E-on-dev gate; the
 * Quinn-runnable real-HTTP harness is e2e/journeys/assessment-c2-config.js.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
	useNavigate: () => navigateMock,
}));

import { AssessmentConfigureFlow, type CatalogTopic } from './assessment-configure';
import { CandidateAssessmentsPage } from './assessments';

const TOPIC: CatalogTopic = {
	id: 11,
	slug: 'python-core',
	name: 'Python Core',
	description: 'Core Python language questions',
	availability: {
		formats: {
			mcq: { easy: 12, medium: 30, hard: 9 },
			short_answer: { easy: 4, medium: 11, hard: 3 },
			mixed: { easy: 16, medium: 41, hard: 12 },
			coding: { easy: 0, medium: 0, hard: 0 },
		},
		maxCount: 41,
		available: true,
	},
	progress: null,
};

function availabilityResponse(over: Record<string, unknown> = {}) {
	return { promised: 10, servable: 41, largestAvailable: 41, reason: null, ...over };
}

function renderFlow() {
	return render(<AssessmentConfigureFlow subjectName="Python" topic={TOPIC} onClose={vi.fn()} />);
}

beforeEach(() => {
	apiCallMock.mockReset();
	navigateMock.mockReset();
	sessionStorage.clear();
});

describe('JT-C1 — configure → pre-flight → instructions → start', () => {
	test('pre-flight is called with the chosen configuration and instructions show it exactly', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) return availabilityResponse({ promised: 25, servable: 41 });
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();

		// Default configuration pre-flights on mount (mixed / medium / 10).
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mixed&band=medium&count=10',
			),
		);

		// Candidate picks MCQ + Hard + 25.
		fireEvent.click(screen.getByRole('button', { name: 'Multiple choice' }));
		fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
		fireEvent.click(screen.getByRole('button', { name: '25' }));
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mcq&band=hard&count=25',
			),
		);

		// The candidate is told exactly what they will get before continuing.
		expect(await screen.findByText(/exactly 25 questions/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /continue to instructions/i }));

		// Instructions state the exact chosen configuration.
		expect(await screen.findByText(/before you start/i)).toBeInTheDocument();
		expect(screen.getByText(/Python Core/)).toBeInTheDocument();
		expect(screen.getByText(/Multiple choice/)).toBeInTheDocument();
		expect(screen.getByText(/Hard — questions adapt between levels 4 and 5/)).toBeInTheDocument();
		expect(screen.getByText(/25 questions/)).toBeInTheDocument();
	});

	test('Start posts the exact configured body and navigates into the runner', async () => {
		apiCallMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
			if (url.includes('/availability')) return availabilityResponse({ promised: 25 });
			if (url === '/assessments/start' && opts?.method === 'POST') {
				return { sessionId: 4242, skillName: 'Python', question: { id: 1 } };
			}
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: '25' }));
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		fireEvent.click(await screen.findByRole('button', { name: 'Start Test' }));

		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/start',
				expect.objectContaining({
					method: 'POST',
					body: { topicId: 11, format: 'mixed', difficultyBand: 'medium', totalQuestions: 25 },
				}),
			),
		);
		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith('/candidate/assessments/4242/take'),
		);
		const stored = JSON.parse(sessionStorage.getItem('assessment_4242') || '{}');
		expect(stored.skillName).toBe('Python');
	});
});

describe('JT-C4 — honest states before start', () => {
	test('insufficient supply: reason shown, smaller count offered ONLY as a labelled choice', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('count=50')) {
				return availabilityResponse({
					promised: 50,
					servable: 7,
					largestAvailable: 7,
					reason: 'Only 7 approved questions are available for this configuration right now.',
				});
			}
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: '50' }));

		expect(
			await screen.findByText('Only 7 approved questions are available for this configuration right now.'),
		).toBeInTheDocument();
		// No silent substitution: instructions are unreachable at 50…
		expect(screen.queryByRole('button', { name: /continue to instructions/i })).not.toBeInTheDocument();
		// …the smaller count is an explicit, labelled offer.
		fireEvent.click(screen.getByRole('button', { name: 'Use 7 questions instead' }));
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mixed&band=medium&count=7',
			),
		);
	});

	test('zero supply: honest empty state, no start path at all', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) {
				return availabilityResponse({
					promised: 10,
					servable: 0,
					largestAvailable: 0,
					reason: 'No approved questions are available for this topic, format and difficulty yet.',
				});
			}
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		expect(
			await screen.findByText('No approved questions are available for this topic, format and difficulty yet.'),
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /continue to instructions/i })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /use \d+ questions instead/i })).not.toBeInTheDocument();
	});

	test('503 at start: saved session is resumable and largestAvailable is offered, not substituted', async () => {
		const err = new Error(
			'Not enough questions are available for this configuration yet. Your attempt has been saved — you can resume it, or choose the available count instead.',
		) as Error & Record<string, unknown>;
		Object.assign(err, {
			status: 503,
			code: 'QUESTION_UNAVAILABLE',
			retryable: true,
			sessionId: 777,
			promised: 25,
			largestAvailable: 7,
		});
		apiCallMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
			if (url.includes('/availability')) return availabilityResponse({ promised: 25 });
			if (url === '/assessments/start' && opts?.method === 'POST') throw err;
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: '25' }));
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		fireEvent.click(await screen.findByRole('button', { name: 'Start Test' }));

		fireEvent.click(await screen.findByRole('button', { name: 'Resume attempt' }));
		expect(navigateMock).toHaveBeenCalledWith('/candidate/assessments/777/take');
		// The start was NOT silently retried at a different count.
		const startCalls = apiCallMock.mock.calls.filter((c) => c[0] === '/assessments/start');
		expect(startCalls).toHaveLength(1);
	});
});

describe('JT-C4 — catalogue surface on the assessments page', () => {
	function mockPageApis(catalog: unknown) {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/assessments/catalog') return catalog;
			if (url === '/assessments/results') return { results: [] };
			if (url === '/assessments/assigned') return { attempts: [] };
			if (url === '/assessments/available') return { skills: [] };
			throw new Error(`unexpected ${url}`);
		});
	}

	test('a topic with no servable configuration renders the honest state and no configure action', async () => {
		mockPageApis({
			subjects: [
				{
					id: 1,
					slug: 'python',
					name: 'Python',
					category: 'technical',
					icon: 'Py',
					description: 'Python',
					topics: [
						{
							...TOPIC,
							availability: { ...TOPIC.availability, maxCount: 3, available: false },
						},
					],
				},
			],
		});
		render(<CandidateAssessmentsPage />);
		expect(await screen.findByText(/no questions available for this topic yet/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /configure/i })).not.toBeInTheDocument();
	});

	test('an empty catalogue renders an honest empty message, not a blank tab', async () => {
		mockPageApis({ subjects: [] });
		render(<CandidateAssessmentsPage />);
		expect(await screen.findByText(/no assessments are available yet/i)).toBeInTheDocument();
	});
});
