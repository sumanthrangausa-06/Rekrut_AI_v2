import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyMatchesPage } from '@/pages/candidate/company-matches';

// #1271: a company the AI did not score must render N/A / Insufficient
// data — never the fabricated 50% the API used to invent.

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

function mockApi() {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/candidate/company-matches')) {
			return {
				success: true,
				matches: [
					{
						id: 2,
						name: 'Beta',
						industry: 'Tech',
						match_score: 88,
						value_hook: 'Beta needs you',
						match_reason: 'Strong overlap',
						outreach_difficulty: 'easy',
					},
					{
						id: 1,
						name: 'Alpha',
						industry: 'Tech',
						match_score: null,
						value_hook: 'Opportunity at Alpha',
						match_reason: 'Profile may align with company needs.',
						outreach_difficulty: 'medium',
					},
				],
				total: 2,
				page: 1,
				limit: 20,
				totalPages: 1,
			} as never;
		}
		return {
			success: true,
			profile: { headline: 'Engineer', bio: '', skills: [], experience: [] },
		} as never;
	});
}

describe('Company matches honest score (#1271)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('unscored company → N/A + Insufficient data, no fabricated 50%; real score renders', async () => {
		mockApi();
		render(
			<MemoryRouter>
				<CompanyMatchesPage />
			</MemoryRouter>,
		);
		fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
		expect(await screen.findByText('88%')).toBeInTheDocument();
		expect(screen.getByText('N/A')).toBeInTheDocument();
		expect(screen.getByText('Insufficient data')).toBeInTheDocument();
		expect(screen.queryByText('50%')).not.toBeInTheDocument();
	});
});
