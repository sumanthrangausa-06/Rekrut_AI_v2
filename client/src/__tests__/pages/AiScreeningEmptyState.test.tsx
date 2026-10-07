import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateAiScreeningPage } from '@/pages/candidate/ai-screening';

// Mock the API module
vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const INVITATION = {
	id: 99,
	status: 'invited',
	overall_score: null,
	job_title: 'Data Analyst',
	company_name: 'Acme Inc',
	template_title: 'Screening Template',
	application_id: 50,
	invited_at: new Date().toISOString(),
	started_at: null,
	completed_at: null,
	invite_token: 'abc123',
	invite_url: '/interview/session/abc123',
};

describe('AiScreeningPage — empty state considers both data sources (B3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows "No AI screenings yet" when both sources are empty', async () => {
		mockApiCall.mockImplementation((url: string) => {
			if (url === '/candidates/me/screenings') {
				return Promise.resolve({ success: true, screenings: [] });
			}
			if (url === '/interviews/screening/my-sessions') {
				return Promise.resolve({ success: true, sessions: [] });
			}
			return Promise.reject(new Error('unexpected: ' + url));
		});

		render(
			<MemoryRouter>
				<CandidateAiScreeningPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('No AI screenings yet')).toBeInTheDocument();
		});
	});

	it('does NOT show empty state when interview invitations exist (even with no fit-screenings)', async () => {
		mockApiCall.mockImplementation((url: string) => {
			if (url === '/candidates/me/screenings') {
				return Promise.resolve({ success: true, screenings: [] });
			}
			if (url === '/interviews/screening/my-sessions') {
				return Promise.resolve({ success: true, sessions: [INVITATION] });
			}
			return Promise.reject(new Error('unexpected: ' + url));
		});

		render(
			<MemoryRouter>
				<CandidateAiScreeningPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Interview Invitations')).toBeInTheDocument();
		});
		expect(screen.queryByText('No AI screenings yet')).not.toBeInTheDocument();
	});
});
