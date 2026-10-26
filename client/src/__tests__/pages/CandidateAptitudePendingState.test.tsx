import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateAptitudeTestResultsPage } from '@/pages/candidate/aptitude-test-results';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const ATTEMPT = {
	id: 42,
	test_id: 3,
	score: 10,
	max_score: 30,
	percentile: null,
	anti_cheat_score: 95,
	passed: false,
	status: 'completed',
	time_spent_seconds: 600,
	started_at: new Date().toISOString(),
	completed_at: new Date().toISOString(),
	pass_score: 60,
	duration_minutes: 20,
	tab_switches: 0,
	copy_paste_attempts: 0,
	time_anomalies: 0,
	title: 'Numerical Reasoning',
	detailedAnswers: [
		{
			questionId: 11,
			questionText: 'Explain your approach to the sequence problem',
			answer: 'My pending answer',
			correctAnswer: 'The worked solution',
			isCorrect: null,
			timeTaken: 42,
			category: 'reasoning',
			difficulty: 2,
		},
		{
			questionId: 12,
			questionText: 'What is 2 + 2?',
			answer: 'My wrong answer',
			correctAnswer: '4',
			isCorrect: false,
			timeTaken: 30,
			category: 'arithmetic',
			difficulty: 1,
		},
		{
			questionId: 13,
			questionText: 'What is 3 + 3?',
			answer: 'My correct answer',
			correctAnswer: '6',
			isCorrect: true,
			timeTaken: 20,
			category: 'arithmetic',
			difficulty: 1,
		},
	],
};

async function renderPage() {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/aptitude-tests/attempt/42') return Promise.resolve({ attempt: ATTEMPT });
		return Promise.reject(new Error('unexpected: ' + url));
	});
	render(
		<MemoryRouter initialEntries={['/aptitude-tests/results/42']}>
			<Routes>
				<Route path="/aptitude-tests/results/:id" element={<CandidateAptitudeTestResultsPage />} />
			</Routes>
		</MemoryRouter>,
	);
	await waitFor(() => {
		expect(screen.getByText('Question Breakdown')).toBeInTheDocument();
	});
}

function cardFor(questionText: string) {
	const el = screen.getByText(questionText);
	const card = el.closest('div.rounded-lg');
	if (!card) throw new Error('card not found for ' + questionText);
	return card as HTMLElement;
}

describe('CandidateAptitudeTestResultsPage — pending (unevaluated) answers (#1609)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows a pending answer as "Pending review", never as Incorrect', async () => {
		await renderPage();
		const card = cardFor('Explain your approach to the sequence problem');
		expect(card.textContent).toContain('Pending review');
		expect(card.className).not.toContain('border-red-200');
		expect(card.className).not.toContain('bg-red-50');
		expect(card.className).not.toContain('border-emerald-200');
		const answerEl = screen.getByText('My pending answer');
		expect(answerEl.className).not.toContain('text-destructive');
		expect(answerEl.className).not.toContain('text-emerald-700');
		// The correct answer is revealed only for genuinely wrong answers.
		expect(card.textContent).not.toContain('Correct:');
	});

	it('still shows a genuinely wrong answer as incorrect with the correct answer revealed', async () => {
		await renderPage();
		const card = cardFor('What is 2 + 2?');
		expect(card.textContent).not.toContain('Pending review');
		expect(card.className).toContain('border-red-200');
		expect(screen.getByText('My wrong answer').className).toContain('text-destructive');
		expect(card.textContent).toContain('Correct:');
	});

	it('still shows a genuinely correct answer as correct', async () => {
		await renderPage();
		const card = cardFor('What is 3 + 3?');
		expect(card.textContent).not.toContain('Pending review');
		expect(card.className).toContain('border-emerald-200');
		expect(screen.getByText('My correct answer').className).toContain('text-emerald-700');
	});
});
