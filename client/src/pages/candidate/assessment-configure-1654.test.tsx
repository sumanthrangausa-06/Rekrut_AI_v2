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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
		expect(screen.getByText(/Hard — questions adapt within the Hard band only \(levels 4–5\)/)).toBeInTheDocument();
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
		// #1679 item 9: the configuration hand-off is pinned — the take
		// page's snapshot block keys off stored.config, so its exact
		// shape is part of the contract, not an implementation detail.
		expect(stored.config).toEqual({
			format: 'mixed',
			difficultyBand: 'medium',
			totalQuestions: 25,
			topicName: 'Python Core',
		});
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

describe('Addendum — GAP-6 / GAP-2', () => {
	test('GAP-6: catalogue says available, but the CHOSEN configuration has servable 0 — cannot start it', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('format=coding')) {
				return availabilityResponse({
					promised: 10,
					servable: 0,
					largestAvailable: 0,
					reason: 'Coding assessments are not available yet.',
				});
			}
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		// Default configuration is servable — Continue exists…
		expect(await screen.findByRole('button', { name: /continue to instructions/i })).toBeInTheDocument();
		// …but choosing Coding (servable 0 for this config) removes the start path.
		fireEvent.click(screen.getByRole('button', { name: 'Coding' }));
		expect(await screen.findByText('Coding assessments are not available yet.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /continue to instructions/i })).not.toBeInTheDocument();
	});

	test('GAP-2: a 400 SETS_NOT_AVAILABLE at start gets its own honest state and strands nothing', async () => {
		const err = new Error('Assessment sets are not available yet') as Error & Record<string, unknown>;
		Object.assign(err, { status: 400, code: 'SETS_NOT_AVAILABLE' });
		apiCallMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
			if (url.includes('/availability')) return availabilityResponse();
			if (url === '/assessments/start' && opts?.method === 'POST') throw err;
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		fireEvent.click(await screen.findByRole('button', { name: 'Start Test' }));
		expect(await screen.findByText(/sets are not available yet/i)).toBeInTheDocument();
		expect(screen.getByText(/no attempt was created/i)).toBeInTheDocument();
		// No session exists for this failure — no Resume affordance may appear.
		expect(screen.queryByRole('button', { name: 'Resume attempt' })).not.toBeInTheDocument();
		// #1679 item 9: and no smaller-count offer either — the "Use N
		// instead" offer belongs only to supply-shortfall failures that
		// carry a largestAvailable; a SETS 400 created nothing to offer.
		expect(
			screen.queryByRole('button', { name: /use \d+ questions instead/i }),
		).not.toBeInTheDocument();
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

	test('#1679 item 6: topic progress with bestScore null renders no fabricated Best score', async () => {
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
							progress: { attempts: 2, bestScore: null, lastScore: null, lastAttempted: null },
						},
					],
				},
			],
		});
		render(<CandidateAssessmentsPage />);
		// The real attempt count still shows; the missing score does not
		// become a "Best: /100" (or any /100) figure.
		expect(await screen.findByText(/2 attempts/)).toBeInTheDocument();
		expect(screen.queryByText(/Best:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
	});

	test('#1679 item 6: topic progress with a real bestScore renders it', async () => {
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
							progress: { attempts: 3, bestScore: 73, lastScore: 73, lastAttempted: null },
						},
					],
				},
			],
		});
		render(<CandidateAssessmentsPage />);
		// #1656 R4: the card now renders BOTH Best and Last (§3.7 progress);
		// this fixture has bestScore === lastScore === 73, so /73\/100/
		// matches twice — assert each labelled score distinctly.
		expect(await screen.findByText(/Best:/)).toBeInTheDocument();
		expect(screen.getAllByText(/73\/100/)).toHaveLength(2);
		expect(screen.getByText(/Last:/)).toBeInTheDocument();
	});

	test('#1679 item 7: legacy fallback card never labels a start "Adaptive"', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/assessments/catalog') throw new Error('no catalogue');
			if (url === '/assessments/results') return { results: [] };
			if (url === '/assessments/assigned') return { attempts: [] };
			if (url === '/assessments/available') {
				return {
					skills: [
						{
							catalog_name: 'Python',
							category: 'technical',
							icon: 'PY',
							description: 'Core Python',
							// Server truth (routes/assessments.js): EVERY
							// /available builder hardcodes this string…
							difficulty: 'Adaptive',
							skill_id: 5,
							is_verified: false,
							verified_score: null,
							assessment_count: 0,
							best_score: null,
							last_attempted: null,
						},
					],
				};
			}
			throw new Error(`unexpected ${url}`);
		});
		render(<CandidateAssessmentsPage />);
		expect(await screen.findByText('Python')).toBeInTheDocument();
		// …but a NEW legacy start snapshots mixed / medium (levels 2–4),
		// so "Adaptive" (unbounded) is a false label for what the
		// candidate will actually get. The card states that instead.
		expect(screen.queryByText('Adaptive')).not.toBeInTheDocument();
		expect(screen.getByText(/Mixed · Medium \(levels 2–4\)/)).toBeInTheDocument();
	});
});

describe('#1679 — P1: invented time figures + stale pre-flight race', () => {
	test('P1-1: instructions state only the per-question timer rule — no invented total time', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		expect(await screen.findByText(/before you start/i)).toBeInTheDocument();

		// No invented total: no "Expected time" claim, no per-question
		// minutes figure, no total-minutes figure derived from a constant.
		expect(screen.queryByText(/Expected time/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/minutes per question/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/up to about \d+ minutes/i)).not.toBeInTheDocument();

		// Only the true per-question rule is stated.
		expect(screen.getByText(/Each question has its own timer, shown on the question/i)).toBeInTheDocument();
		expect(
			screen.getByText(/When a question's time runs out, it is submitted with the answer you have chosen/i),
		).toBeInTheDocument();
	});

	test('P1-2: a pending pre-flight for a new count hides Continue until the new response lands', async () => {
		let resolveSecond: (value: unknown) => void = () => {};
		const secondCall = new Promise((resolve) => {
			resolveSecond = resolve;
		});
		apiCallMock.mockImplementation((url: string) => {
			if (url.includes('count=25')) return secondCall;
			if (url.includes('/availability')) {
				return Promise.resolve(availabilityResponse({ promised: 10, servable: 41 }));
			}
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();

		// First configuration is servable — Continue is offered.
		expect(await screen.findByRole('button', { name: /continue to instructions/i })).toBeInTheDocument();

		// Candidate changes the count; the new pre-flight hangs.
		fireEvent.click(screen.getByRole('button', { name: '25' }));
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mixed&band=medium&count=25',
			),
		);

		// While the new check is pending, the STALE result must not keep
		// Continue clickable for the new configuration.
		expect(screen.queryByRole('button', { name: /continue to instructions/i })).not.toBeInTheDocument();

		// When the new response lands, Continue reflects THAT response.
		await act(async () => {
			resolveSecond(availabilityResponse({ promised: 25, servable: 41 }));
		});
		expect(await screen.findByText(/exactly 25 questions/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /continue to instructions/i })).toBeInTheDocument();
	});
});

describe('#1679 — items 3–5 + NIT hardening', () => {
	test('item 3: format labels follow spec §0.2 (Mixed spelled out, Written answers)', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		expect(
			screen.getByRole('button', { name: 'Mixed — multiple choice and written answers' }),
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Written answers' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Multiple choice' })).toBeInTheDocument();
		// Flush the mount pre-flight so its state update lands inside the test.
		expect(await screen.findByText(/exactly 10 questions/i)).toBeInTheDocument();
	});

	test('item 3: AI-scoring disclosure is ABSENT for an MCQ-only configuration', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		fireEvent.click(screen.getByRole('button', { name: 'Multiple choice' }));
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		expect(await screen.findByText(/before you start/i)).toBeInTheDocument();
		expect(screen.queryByText(/scored by AI and reviewed by a human/i)).not.toBeInTheDocument();
	});

	test('item 3: AI-scoring disclosure SHOWS for Mixed and for Written answers', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) return availabilityResponse();
			throw new Error(`unexpected ${url}`);
		});
		// Mixed (the default format) includes written answers.
		const first = renderFlow();
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		expect(await screen.findByText(/scored by AI and reviewed by a human/i)).toBeInTheDocument();
		first.unmount();
		// Written answers, explicitly chosen.
		renderFlow();
		fireEvent.click(screen.getByRole('button', { name: 'Written answers' }));
		fireEvent.click(await screen.findByRole('button', { name: /continue to instructions/i }));
		expect(await screen.findByText(/scored by AI and reviewed by a human/i)).toBeInTheDocument();
	});

	test('item 4: a failed pre-flight offers Retry, which re-checks the CURRENT configuration', async () => {
		let calls = 0;
		apiCallMock.mockImplementation(async (url: string) => {
			if (url.includes('/availability')) {
				calls += 1;
				if (calls === 1) throw new Error('network down');
				return availabilityResponse();
			}
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		expect(await screen.findByText(/could not check question availability/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /retry/i }));
		// The retry re-ran the check for the same (current) configuration
		// — the candidate did not have to change their selection.
		expect(await screen.findByText(/exactly 10 questions/i)).toBeInTheDocument();
		expect(calls).toBe(2);
		expect(apiCallMock).toHaveBeenCalledWith(
			'/assessments/catalog/11/availability?format=mixed&band=medium&count=10',
		);
	});

	test('item 5: an accepted non-enum count renders as inert text, never a dead button', async () => {
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
		fireEvent.click(await screen.findByRole('button', { name: 'Use 7 questions instead' }));
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mixed&band=medium&count=7',
			),
		);
		// The accepted 7 is shown, but NOT as a button with no action.
		expect(screen.queryByRole('button', { name: '7' })).not.toBeInTheDocument();
		expect(screen.getByText('7')).toBeInTheDocument();
	});

	test('NIT (#1680): while a re-check is pending, the previous short-supply offer is not actionable', async () => {
		let resolveSecond: (value: unknown) => void = () => {};
		const secondCall = new Promise((resolve) => {
			resolveSecond = resolve;
		});
		apiCallMock.mockImplementation((url: string) => {
			if (url.includes('count=25')) return secondCall;
			if (url.includes('/availability')) {
				return Promise.resolve(
					availabilityResponse({
						promised: 10,
						servable: 7,
						largestAvailable: 7,
						reason: 'Only 7 approved questions are available for this configuration right now.',
					}),
				);
			}
			throw new Error(`unexpected ${url}`);
		});
		renderFlow();
		expect(
			await screen.findByRole('button', { name: 'Use 7 questions instead' }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: '25' }));
		await waitFor(() =>
			expect(apiCallMock).toHaveBeenCalledWith(
				'/assessments/catalog/11/availability?format=mixed&band=medium&count=25',
			),
		);
		// The stale offer (for the OLD configuration) must not stay
		// clickable while the new configuration is still being checked.
		expect(
			screen.queryByRole('button', { name: /use \d+ questions instead/i }),
		).not.toBeInTheDocument();
		await act(async () => {
			resolveSecond(availabilityResponse({ promised: 25, servable: 41 }));
		});
		expect(await screen.findByText(/exactly 25 questions/i)).toBeInTheDocument();
	});
});
