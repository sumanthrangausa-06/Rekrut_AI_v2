import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterJobAssessmentPage } from '@/pages/recruiter/job-assessment';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

// PR #1641, delta re-review F4 remainder (comment 6338010785): the
// recruiter "Submitted with no answers — not scored" bucket must hold
// ONLY the terminal zero-answer state. `completed && !scored_at` alone
// also matches attempts still in the scoring window and attempts whose
// scoring failed — candidates who DID answer. The payload already
// carries the discriminators: completion_flags.answers_given and
// scores.unscored (written by scoreAttempt only for zero answers).
const NO_ANSWERS_LABEL = 'Submitted with no answers — not scored';

const ASSESSMENT = {
	id: 42,
	job_id: 7,
	title: 'Backend Assessment',
	description: 'Job assessment',
	status: 'published',
	difficulty_level: 'medium',
	question_count: 5,
	categories: [],
	questions: [],
	stats: { total_attempts: 3, completed: 3, avg_score: 0 },
	published_at: null,
	created_at: new Date().toISOString(),
};

function attempt(overrides: Record<string, unknown>) {
	return {
		id: 0,
		composite_score: null,
		category_scores: {},
		ai_summary: null,
		anti_cheat_score: 100,
		status: 'completed',
		completed_at: new Date().toISOString(),
		scored_at: null,
		time_spent_seconds: 120,
		candidate_id: 0,
		...overrides,
	};
}

const ATTEMPTS = [
	// (a) Terminal zero-answer state: completed partial, answers_given 0,
	// scoreAttempt recorded scores.unscored — belongs in the bucket.
	attempt({
		id: 1,
		candidate_id: 11,
		candidate_name: 'NoAnswers Nora',
		candidate_email: 'nora@example.com',
		completion_flags: { partial: true, answers_given: 0, total_questions: 5 },
		scores: { compositeScore: null, unscored: true, unscored_reason: 'no_answers' },
	}),
	// (b) Answered, scoring pending/failed: completed, scored_at still
	// NULL by design, but answers WERE given — must NOT carry the label.
	attempt({
		id: 2,
		candidate_id: 12,
		candidate_name: 'Answered Andy',
		candidate_email: 'andy@example.com',
		completion_flags: { partial: true, answers_given: 3, total_questions: 5 },
		scores: null,
	}),
	// (c) Completed and scored — a normal scored result, never the bucket.
	attempt({
		id: 3,
		candidate_id: 13,
		candidate_name: 'Scored Sara',
		candidate_email: 'sara@example.com',
		composite_score: 80,
		scored_at: new Date().toISOString(),
		completion_flags: { partial: false, answers_given: 5, total_questions: 5 },
		scores: { compositeScore: 80 },
	}),
];

function mockEndpoints() {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/assessments/job/7') return Promise.resolve({ assessment: ASSESSMENT });
		if (url === '/assessments/job-assessment/42/results')
			return Promise.resolve({ attempts: ATTEMPTS });
		return Promise.reject(new Error('unexpected: ' + url));
	});
}

async function openResults() {
	render(
		<MemoryRouter initialEntries={['/recruiter/jobs/7/assessment']}>
			<Routes>
				<Route path="/recruiter/jobs/:id/assessment" element={<RecruiterJobAssessmentPage />} />
			</Routes>
		</MemoryRouter>,
	);
	fireEvent.click(await screen.findByRole('button', { name: /Results/ }));
	await waitFor(() => {
		expect(screen.getByText('Scored Sara')).toBeInTheDocument();
	});
}

describe('RecruiterJobAssessmentPage — "no answers" bucket (PR #1641 F4 remainder)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEndpoints();
	});

	it('(a) puts a completed zero-answer unscored attempt in the bucket', async () => {
		await openResults();
		const labels = screen.getAllByText(NO_ANSWERS_LABEL);
		expect(labels).toHaveLength(1);
		// The bucket row pairs the candidate's name with the label.
		expect(screen.getByText('NoAnswers Nora').closest('div')?.textContent).toContain(
			NO_ANSWERS_LABEL,
		);
	});

	it('(b) does NOT put an answered attempt with scored_at NULL (scoring pending/failed) in the bucket', async () => {
		await openResults();
		expect(screen.queryByText('Answered Andy')).not.toBeInTheDocument();
		expect(screen.getAllByText(NO_ANSWERS_LABEL)).toHaveLength(1);
	});

	it('(c) does NOT put a completed, scored attempt in the bucket', async () => {
		await openResults();
		expect(screen.getByText('Scored Sara')).toBeInTheDocument();
		const labels = screen.getAllByText(NO_ANSWERS_LABEL);
		expect(labels).toHaveLength(1);
		expect(screen.getByText('NoAnswers Nora').closest('div')?.textContent).toContain(
			NO_ANSWERS_LABEL,
		);
	});
});
