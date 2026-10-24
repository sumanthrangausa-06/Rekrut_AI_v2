import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterAssessmentsPage } from '@/pages/recruiter/assessments';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const LIST_ITEM = {
	id: 1,
	score: 33,
	max_score: 100,
	passed: false,
	anti_cheat_score: 90,
	duration_seconds: 600,
	completed_at: new Date().toISOString(),
	title: 'JS Assessment',
	skill_name: 'JavaScript',
	category: 'technical',
	is_verified: false,
	max_difficulty_reached: 3,
	tab_switches: 0,
	copy_paste_attempts: 0,
	candidate_name: 'Pending Pat',
	candidate_email: 'pat@example.com',
	candidate_id: 7,
};

const DETAIL = {
	...LIST_ITEM,
	time_anomalies: 0,
	detailedAnswers: [
		{
			questionId: 11,
			answer: 'My pending answer',
			isCorrect: null,
			scorePoints: 0,
			timeTaken: 42,
			aiFeedback: 'Evaluation unavailable — recorded for manual review',
			questionText: 'Explain recursion in your own words',
			questionType: 'short_answer',
			correctAnswer: 'A function that calls itself',
			difficulty: 2,
		},
		{
			questionId: 12,
			answer: 'My wrong answer',
			isCorrect: false,
			scorePoints: 0,
			timeTaken: 30,
			questionText: 'What is 2 + 2?',
			questionType: 'short_answer',
			correctAnswer: '4',
			difficulty: 1,
		},
		{
			questionId: 13,
			answer: 'My correct answer',
			isCorrect: true,
			scorePoints: 10,
			timeTaken: 20,
			questionText: 'What is a closure?',
			questionType: 'short_answer',
			difficulty: 2,
		},
	],
};

function mockEndpoints() {
	mockApiCall.mockImplementation((url: string) => {
		if (url.startsWith('/assessments/recruiter/all'))
			return Promise.resolve({
				assessments: [LIST_ITEM],
				stats: null,
				skillBreakdown: [],
			});
		if (url === '/assessments/recruiter/catalog') return Promise.resolve({ catalog: [] });
		if (url === '/assessments/job-assessments/all') return Promise.resolve({ results: [] });
		if (url === '/assessments/recruiter/detail/1') return Promise.resolve({ assessment: DETAIL });
		return Promise.reject(new Error('unexpected: ' + url));
	});
}

async function openDetail() {
	render(
		<MemoryRouter>
			<RecruiterAssessmentsPage />
		</MemoryRouter>,
	);
	fireEvent.click(await screen.findByText('Skill Tests'));
	await waitFor(() => {
		expect(screen.getByText('Pending Pat')).toBeInTheDocument();
	});
	fireEvent.click(screen.getByRole('button', { name: /Details/ }));
	await waitFor(() => {
		expect(screen.getByText('Question-by-Question')).toBeInTheDocument();
	});
}

function cardFor(questionText: string) {
	const el = screen.getByText(questionText);
	const card = el.closest('div.rounded-lg');
	if (!card) throw new Error('card not found for ' + questionText);
	return card as HTMLElement;
}

describe('RecruiterAssessmentsPage — pending (unevaluated) answers (#1584 item 3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEndpoints();
	});

	it('shows a pending answer as "Pending review" with neutral styling, NOT as incorrect', async () => {
		await openDetail();
		const card = cardFor('Explain recursion in your own words');
		expect(card.textContent).toContain('Pending review');
		expect(card.className).not.toContain('border-red-200');
		expect(card.className).not.toContain('bg-red-50');
		expect(card.className).not.toContain('border-emerald-200');
		const answerEl = screen.getByText('My pending answer');
		expect(answerEl.className).not.toContain('text-destructive');
		expect(answerEl.className).not.toContain('text-emerald-700');
		// The "Correct:" reveal is for genuinely wrong answers only.
		expect(card.textContent).not.toContain('Correct:');
	});

	it('still shows a genuinely wrong answer as incorrect', async () => {
		await openDetail();
		const card = cardFor('What is 2 + 2?');
		expect(card.textContent).not.toContain('Pending review');
		expect(card.className).toContain('border-red-200');
		expect(screen.getByText('My wrong answer').className).toContain('text-destructive');
		expect(card.textContent).toContain('Correct:');
	});

	it('still shows a genuinely correct answer as correct', async () => {
		await openDetail();
		const card = cardFor('What is a closure?');
		expect(card.textContent).not.toContain('Pending review');
		expect(card.className).toContain('border-emerald-200');
		expect(screen.getByText('My correct answer').className).toContain('text-emerald-700');
	});
});
