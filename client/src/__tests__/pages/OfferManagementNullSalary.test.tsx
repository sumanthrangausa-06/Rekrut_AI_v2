import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfferManagementPage } from '@/pages/candidate/offer-management';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const SKELETON_OFFER = {
	id: 42,
	candidate_name: 'Unknown',
	candidate_email: '',
	title: 'Skeleton Offer',
	job_title: null,
	salary: null,
	start_date: null,
	status: 'draft',
	benefits: null,
	created_at: new Date().toISOString(),
};

const NORMAL_OFFER = {
	...SKELETON_OFFER,
	id: 43,
	title: 'Normal Offer',
	salary: 120000,
};

function mockEndpoints(offers: unknown[]) {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/onboarding/offers') return Promise.resolve({ offers });
		if (url === '/recruiter/candidates') return Promise.resolve({ candidates: [] });
		if (url === '/jobs') return Promise.resolve({ jobs: [] });
		return Promise.reject(new Error('unexpected: ' + url));
	});
}

describe('OfferManagementPage — skeleton (NULL-salary) offers (#1139)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a NULL-salary skeleton offer without crashing, showing — not a fabricated amount', async () => {
		mockEndpoints([SKELETON_OFFER]);
		render(
			<MemoryRouter>
				<OfferManagementPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Skeleton Offer')).toBeInTheDocument();
		});
		expect(screen.getByText('—')).toBeInTheDocument();
		expect(screen.queryByText('$0')).not.toBeInTheDocument();
	});

	it('formats a string salary (Postgres DECIMAL serialises as string, as on sibling offer pages)', async () => {
		mockEndpoints([{ ...SKELETON_OFFER, id: 44, title: 'String Salary Offer', salary: '90000' }]);
		render(
			<MemoryRouter>
				<OfferManagementPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('$90,000')).toBeInTheDocument();
		});
	});

	it('still renders a normal salary formatted', async () => {
		mockEndpoints([NORMAL_OFFER]);
		render(
			<MemoryRouter>
				<OfferManagementPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('$120,000')).toBeInTheDocument();
		});
	});
});
