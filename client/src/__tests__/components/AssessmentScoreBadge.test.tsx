import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { KanbanCard } from '@/components/candidate/kanban-card';

function renderCard(overrides = {}) {
	const item = {
		type: 'application' as const,
		data: {
			id: 1,
			job_id: 10,
			status: 'screening',
			title: 'Backend Engineer',
			company: 'Acme',
			applied_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			...overrides,
		},
	};
	return render(
		<MemoryRouter>
			<KanbanCard item={item} columnId="in_discussion" />
		</MemoryRouter>,
	);
}

describe('Assessment score badge (transparency)', () => {
	it('shows the assessment score when present', () => {
		renderCard({ assessment_score: 85, assessment_result: 'pass' });
		expect(screen.getByText(/85\/100/)).toBeInTheDocument();
	});

	it('shows pass/fail state via tooltip', () => {
		const { unmount } = renderCard({ assessment_score: 85, assessment_result: 'pass' });
		expect(screen.getByTitle(/passed this assessment/i)).toBeInTheDocument();
		unmount();

		renderCard({ assessment_score: 45, assessment_result: 'fail' });
		expect(screen.getByTitle(/did not pass/i)).toBeInTheDocument();
	});

	it('hides the badge when no score exists', () => {
		const { container } = renderCard({});
		expect(container.textContent).not.toMatch(/\/100/);
	});
});
