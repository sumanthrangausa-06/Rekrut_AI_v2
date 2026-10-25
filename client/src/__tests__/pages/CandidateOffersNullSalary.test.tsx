import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateOffersPage } from '@/pages/candidate/offers';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const SKELETON_OFFER = {
	id: 42,
	title: 'Skeleton Offer',
	company_name: 'Unknown Co',
	company: 'Unknown Co',
	job_title: 'Skeleton Role',
	salary: null,
	start_date: null,
	benefits: null,
	status: 'sent',
	sent_at: new Date().toISOString(),
	viewed_at: new Date().toISOString(),
	accepted_at: null,
	declined_at: null,
	decline_reason: null,
	created_at: new Date().toISOString(),
	has_letter: false,
	candidate_signature: null,
	candidate_signed_at: null,
};

const NORMAL_OFFER = {
	...SKELETON_OFFER,
	id: 43,
	title: 'Normal Offer',
	salary: 120000,
};

function mockEndpoints(offers: unknown[]) {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/onboarding/offers/me') return Promise.resolve(offers);
		return Promise.reject(new Error('unexpected: ' + url));
	});
}

describe('CandidateOffersPage — skeleton (NULL-salary) offers (#1301)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a NULL-salary skeleton offer in the list showing — not a fabricated $0/yr', async () => {
		mockEndpoints([SKELETON_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<CandidateOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Skeleton Offer')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('—');
		expect(container.textContent).not.toContain('$0');
	});

	it('shows — not $0 in the detail and sign dialogs for a NULL-salary offer', async () => {
		mockEndpoints([SKELETON_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<CandidateOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Skeleton Offer')).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText('Skeleton Offer'));
		await waitFor(() => {
			expect(screen.getByText('Salary')).toBeInTheDocument();
		});
		expect(container.textContent).not.toContain('$0');

		fireEvent.click(screen.getByRole('button', { name: /Sign & Accept Offer/ }));
		await waitFor(() => {
			expect(screen.getByText('E-Signature Agreement')).toBeInTheDocument();
		});
		expect(container.textContent).not.toContain('$0');
		expect(container.textContent).toContain('—');
	});

	it('still renders a normal salary formatted in the list', async () => {
		mockEndpoints([NORMAL_OFFER]);
		const { container } = render(
			<MemoryRouter>
				<CandidateOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Normal Offer')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('$120,000/yr');
	});

	it('formats a string salary (Postgres DECIMAL serialises as string)', async () => {
		mockEndpoints([{ ...SKELETON_OFFER, id: 44, title: 'String Salary Offer', salary: '90000' }]);
		const { container } = render(
			<MemoryRouter>
				<CandidateOffersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('String Salary Offer')).toBeInTheDocument();
		});
		expect(container.textContent).toContain('$90,000/yr');
	});
});
