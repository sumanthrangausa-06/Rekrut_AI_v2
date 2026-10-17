/**
 * #1261 — Career Diagnosis submit must hit the real server route with the
 * shape the handler actually accepts.
 *
 * Server: POST /api/career-diagnosis
 *   (routes/profile-enhancement.js, flat-mounted under /api at server.js:692;
 *    handler destructures `{ quizAnswers }` from req.body and 400s unless it
 *    is a non-empty array; responds `{ success, diagnosis: { … } }` with
 *    camelCase diagnosis fields).
 * apiCall (client/src/lib/api.ts) prepends `/api` and JSON-stringifies the
 * body itself, so the page must call `/career-diagnosis` with a plain-object
 * body `{ quizAnswers }`.
 *
 * Before the fix the page called '/profile-enhancement/career-diagnosis'
 * (→ wire POST /api/profile-enhancement/career-diagnosis → 404) with
 * `body: JSON.stringify({ answers })` — wrong field AND double-stringified.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CareerDiagnosisPage } from '@/pages/candidate/career-diagnosis';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

// Exactly what routes/profile-enhancement.js POST /career-diagnosis returns
// (mockCareerDiagnosis output wrapped in the diagnosis envelope).
const SERVER_RESPONSE = {
	success: true,
	diagnosis: {
		id: 7,
		careerArchetype: {
			name: 'The Technical Builder',
			description: 'You naturally gravitate toward technical builder roles.',
		},
		recommendedPaths: [
			{
				pathName: 'Staff Engineer',
				fitScore: 76,
				description: 'Deep technical expertise across multiple domains.',
				timeToAchievable: '3-5 years',
				requiredSkills: ['Architecture', 'Mentoring'],
				skillsToDevelop: ['Technical Writing'],
			},
		],
		strengths: ['Analytical thinking'],
		growthAreas: ['Public speaking'],
		recommendedRoles: [
			{
				title: 'Staff Software Engineer',
				whyFits: 'Leverages your technical breadth.',
				salaryRange: '$160K - $250K',
			},
		],
		actionPlan: [
			{
				phase: 'Short-term (0-6 months)',
				actions: ['Mentor a junior engineer'],
				timeline: '0-6 months',
			},
		],
		summary: 'As a The Technical Builder, you are well-positioned for growth.',
	},
};

async function answerAllQuestions() {
	fireEvent.click(screen.getByRole('button', { name: /Start Assessment/i }));
	// 10 questions; click the first option ("A" badge) on each.
	for (let q = 0; q < 10; q++) {
		const optionButtons = await screen.findAllByRole('button');
		const firstOption = optionButtons.find((b) => b.textContent?.trim().startsWith('A'));
		if (!firstOption) throw new Error(`No option button found at question ${q + 1}`);
		fireEvent.click(firstOption);
	}
}

describe('#1261 Career Diagnosis request shape', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApiCall.mockResolvedValue(SERVER_RESPONSE as never);
	});

	it('POSTs quizAnswers (plain object, single-stringified by apiCall) to the flat route', async () => {
		render(<CareerDiagnosisPage />);
		await answerAllQuestions();

		await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
		const [url, options] = mockApiCall.mock.calls[0] as unknown as [
			string,
			{ method?: string; body?: unknown },
		];

		expect(url).toBe('/career-diagnosis');
		expect(url).not.toBe('/profile-enhancement/career-diagnosis');
		// Constructed wire URL (apiCall prepends /api) is the real route.
		expect(`/api${url}`).toBe('/api/career-diagnosis');
		expect(options.method).toBe('POST');

		// Body must be the plain object — apiCall stringifies it exactly once.
		// A string here means the wire body is double-stringified and the
		// handler's `req.body.quizAnswers` is undefined → 400.
		expect(typeof options.body).not.toBe('string');
		const body = options.body as { quizAnswers?: unknown; answers?: unknown };
		expect(body.answers).toBeUndefined();
		expect(Array.isArray(body.quizAnswers)).toBe(true);
		const quizAnswers = body.quizAnswers as { question: string; answer: string }[];
		expect(quizAnswers).toHaveLength(10);
		expect(quizAnswers[0]).toEqual({
			question: 'How do you prefer to solve problems?',
			answer: 'Analyze data and find patterns',
		});
	});

	it('renders the server diagnosis envelope (diagnosis.* with camelCase fields)', async () => {
		render(<CareerDiagnosisPage />);
		await answerAllQuestions();

		expect(await screen.findByText('The Technical Builder')).toBeInTheDocument();
		expect(await screen.findByText('Staff Engineer')).toBeInTheDocument();
		expect(await screen.findByText('76% fit')).toBeInTheDocument();
		expect(await screen.findByText('Staff Software Engineer')).toBeInTheDocument();
		expect(await screen.findByText('$160K - $250K')).toBeInTheDocument();
	});
});
