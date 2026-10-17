import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterOffersPage } from '@/pages/recruiter/offers';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const SKELETON_OFFER = {
	id: 42,
	candidate_id: 7,
	job_id: 9,
	title: 'Skeleton Offer',
	company_name: 'Unknown Co',
	candidate_name: 'Unknown',
	candidate_email: '',
	job_title: 'Skeleton Role',
	recruiter_name: '',
	salary: null,
	start_date: null,
	benefits: null,
	reporting_to: null,
	location: null,
	employment_type: 'full-time',
	status: 'sent',
	sent_at: new Date().toISOString(),
	viewed_at: null,
	accepted_at: null,
	declined_at: null,
	decline_reason: null,
	created_at: new Date().toISOString(),
	has_letter: false,
	offer_letter_html: null,
	offer_letter_generated_at: null,
};

const NORMAL_OFFER = {
	...SKELETON_OFFER,
	id: 43,
	candidate_name: 'Jane Normal',
	salary: 120000,
};

function mockEndpoints(offers: unknown[]) {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/onboarding/offers') return Promise.resolve(offers);
		if (url === '/recruiter/candidates') return Promise.resolve({ candidates: [] });
		if (url === '/recruiter/jobs') return Promise.resolve({ jobs: [] });
		return Promise.reject(new Error('unexpected: ' + url));
	});
}

describe('RecruiterOffersPage — skeleton (NULL-salary) offers (#1301)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a NULL-salary skeleton offer in the list showing — not a fabricated $0/yr', async () => {
		mockEndpoints([SKELETON_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Skeleton Role')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('—');
		expect(container.textContent).not.toContain('$0');
	});

	it('shows — not $0 in the detail dialog for a NULL-salary offer', async () => {
		mockEndpoints([SKELETON_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Skeleton Role')).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText('Skeleton Role'));
		await waitFor(() => {
			expect(screen.getByText('Offer Details')).toBeInTheDocument();
		});
		expect(container.textContent).not.toContain('$0');
		expect(container.textContent).toContain('—');
	});

	it('still renders a normal salary formatted in the list', async () => {
		mockEndpoints([NORMAL_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Jane Normal')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('$120,000/yr');
	});

	it('formats a string salary (Postgres DECIMAL serialises as string)', async () => {
		mockEndpoints([{ ...SKELETON_OFFER, id: 44, candidate_name: 'String Salary', salary: '90000' }]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('String Salary')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('$90,000/yr');
	});
});
