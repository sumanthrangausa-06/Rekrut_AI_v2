import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateAptitudeTestTakePage } from '@/pages/candidate/aptitude-test-take';
import { AssessmentTakePage } from '@/pages/candidate/assessment-take';
import { JobAssessmentTakePage } from '@/pages/candidate/job-assessment-take';

// Mock the API module
vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const DISCLOSURE = /scored by AI and reviewed by a human/i;

function renderAt(path: string, route: string, element: React.ReactNode) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path={route} element={element} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('AI disclosure banner (#343 task 5)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionStorage.clear();
	});

	it('JobAssessmentTakePage shows the AI disclosure banner', async () => {
		mockApiCall.mockResolvedValue({
			attemptId: 1,
			resumed: false,
			progress: { current: 1, total: 15 },
			question: {
				id: 1,
				category: 'technical',
				type: 'multiple_choice',
				text: 'What is a closure?',
				options: ['A', 'B'],
				timeLimit: 120,
				points: 10,
				difficulty: 2,
			},
			timeLimitMinutes: 45,
			startedAt: new Date().toISOString(),
		});
		const { unmount } = renderAt(
			'/candidate/job-assessment/5',
			'/candidate/job-assessment/:id',
			<JobAssessmentTakePage />,
		);
		expect(await screen.findByText(DISCLOSURE)).toBeInTheDocument();
		unmount();
	});

	it('AssessmentTakePage shows the AI disclosure banner', async () => {
		sessionStorage.setItem(
			'assessment_7',
			JSON.stringify({
				question: {
					id: 1,
					text: 'What is hoisting?',
					type: 'multiple_choice',
					options: ['A', 'B'],
					timeLimit: 120,
					questionNumber: 1,
					totalQuestions: 10,
				},
				skillName: 'JavaScript',
			}),
		);
		const { unmount } = renderAt(
			'/candidate/assessments/7/take',
			'/candidate/assessments/:id/take',
			<AssessmentTakePage />,
		);
		expect(await screen.findByText(DISCLOSURE)).toBeInTheDocument();
		unmount();
	});

	it('CandidateAptitudeTestTakePage shows the AI disclosure banner', async () => {
		sessionStorage.setItem(
			'aptitude_9',
			JSON.stringify({
				question: {
					id: 1,
					text: '2, 4, 8, 16, ?',
					category: 'numerical',
					difficulty: 2,
					options: ['24', '32'],
					timeLimit: 60,
					questionNumber: 1,
					totalQuestions: 20,
				},
				test: { title: 'Logic Test', durationMinutes: 15 },
				maxScore: 100,
			}),
		);
		const { unmount } = renderAt(
			'/aptitude-tests/3/take?attempt=9',
			'/aptitude-tests/:id/take',
			<CandidateAptitudeTestTakePage />,
		);
		expect(await screen.findByText(DISCLOSURE)).toBeInTheDocument();
		unmount();
	});
});
