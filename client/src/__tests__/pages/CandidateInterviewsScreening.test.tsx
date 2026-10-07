import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateInterviewsPage } from '@/pages/candidate/interviews';

// Mock the API module
vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const HUMAN_INTERVIEW = {
	id: 1,
	scheduled_at: new Date(Date.now() + 864e5).toISOString(),
	duration_minutes: 60,
	interview_type: 'video',
	meeting_link: 'https://meet.example.com/1',
	notes: null,
	status: 'scheduled',
	outcome: null,
	feedback: null,
	created_at: new Date().toISOString(),
	job_title: 'Data Analyst',
	job_id: 10,
	company_name: 'Acme Inc',
	company_full_name: null,
	recruiter_name: 'Jane Recruiter',
	recruiter_email: 'jane@acme.com',
};

const SCREENING_SESSION = {
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
	invite_token: 'abc123token',
	invite_url: '/interview/session/abc123',
};

describe('CandidateInterviewsPage — AI screening visibility (#322 gap)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: human interviews endpoint returns one interview,
		// screening endpoint returns one screening
		mockApiCall.mockImplementation((url: string) => {
			if (url === '/candidate/interviews/scheduled') {
				return Promise.resolve({ success: true, interviews: [HUMAN_INTERVIEW] });
			}
			if (url === '/api/interviews/screening/my-sessions') {
				return Promise.resolve({ success: true, sessions: [SCREENING_SESSION] });
			}
			return Promise.reject(new Error(`unexpected URL: ${url}`));
		});
	});

	it('fetches screening sessions in addition to scheduled interviews', async () => {
		render(
			<MemoryRouter>
				<CandidateInterviewsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// Both endpoints must be called
			const urls = mockApiCall.mock.calls.map((c) => c[0]);
			expect(urls).toContain('/candidate/interviews/scheduled');
			expect(urls).toContain('/api/interviews/screening/my-sessions');
		});
	});

	it('displays screening sessions marked as AI Screening', async () => {
		render(
			<MemoryRouter>
				<CandidateInterviewsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			// The screening should appear with an AI Screening label
			expect(screen.getByText(/AI Screening/i)).toBeTruthy();
		});
	});
});
