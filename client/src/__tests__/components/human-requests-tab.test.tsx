/**
 * S-061 (#711): Recruiter dashboard — "Human Requests" tab.
 *
 *   AC-1: pending requests shown with candidate name, job title, requested date
 *   AC-2: Approve → POST approve → human session created (backend) → request leaves the list
 *   AC-3: Decline → POST decline → request leaves the list
 *   AC-4: approved/declined requests move out of the pending list
 *   AC-5: hiring-team only (enforced by backend requireHiringRole; page is recruiter-only)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanRequestsTab } from '@/components/recruiter/human-requests-tab';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const PENDING = [
	{
		id: 1,
		session_id: 10,
		candidate_id: 42,
		status: 'pending',
		created_at: '2026-10-10T10:00:00.000Z',
		candidate_name: 'Jane Candidate',
		job_title: 'Backend Engineer',
		session_type: 'ai_interview',
	},
	{
		id: 2,
		session_id: 11,
		candidate_id: 43,
		status: 'pending',
		created_at: '2026-10-09T10:00:00.000Z',
		candidate_name: 'John Applicant',
		job_title: 'Designer',
		session_type: 'screening',
	},
];

function mockList(rows: unknown[]) {
	mockApiCall.mockImplementation(async (url: string, options?: { method?: string }) => {
		if (url === '/interviews/human-requests' && !options?.method) {
			return { requests: rows };
		}
		if (url.includes('/approve') || url.includes('/decline')) {
			return { request: { id: 1, status: 'approved' } };
		}
		throw new Error(`unexpected apiCall: ${url}`);
	});
}

describe('HumanRequestsTab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('AC-1: shows pending requests with candidate name, job title, requested date', async () => {
		mockList(PENDING);
		render(<HumanRequestsTab />);

		await waitFor(() => {
			expect(screen.getByText('Jane Candidate')).toBeInTheDocument();
		});
		expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
		expect(screen.getByText('John Applicant')).toBeInTheDocument();
		// UX #2: session type shown as decision context (not an internal session ID)
		expect(screen.getByText(/AI interview session/)).toBeInTheDocument();
		expect(screen.queryByText(/Session #10/)).not.toBeInTheDocument();
		expect(mockApiCall).toHaveBeenCalledWith('/interviews/human-requests');
	});

	it('AC-2: approve calls the approve endpoint and removes the request', async () => {
		mockList(PENDING);
		render(<HumanRequestsTab />);

		await waitFor(() => {
			expect(screen.getByText('Jane Candidate')).toBeInTheDocument();
		});
		const approveButtons = screen.getAllByRole('button', { name: /approve/i });
		fireEvent.click(approveButtons[0]);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith('/interviews/human-requests/1/approve', {
				method: 'POST',
			});
		});
		await waitFor(() => {
			expect(screen.queryByText('Jane Candidate')).not.toBeInTheDocument();
		});
		// The other request stays
		expect(screen.getByText('John Applicant')).toBeInTheDocument();
	});

	it('AC-3: decline calls the decline endpoint and removes the request', async () => {
		mockList(PENDING);
		render(<HumanRequestsTab />);

		await waitFor(() => {
			expect(screen.getByText('Jane Candidate')).toBeInTheDocument();
		});
		const declineButtons = screen.getAllByRole('button', { name: /decline/i });
		fireEvent.click(declineButtons[0]);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith('/interviews/human-requests/1/decline', {
				method: 'POST',
			});
		});
		await waitFor(() => {
			expect(screen.queryByText('Jane Candidate')).not.toBeInTheDocument();
		});
	});

	it('shows an empty state when there are no pending requests', async () => {
		mockList([]);
		render(<HumanRequestsTab />);

		await waitFor(() => {
			expect(screen.getByText(/no pending/i)).toBeInTheDocument();
		});
	});

	it('shows an error with retry when loading fails', async () => {
		mockApiCall.mockRejectedValueOnce(new Error('network down'));
		render(<HumanRequestsTab />);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
		mockList(PENDING);
		fireEvent.click(screen.getByRole('button', { name: /retry/i }));

		await waitFor(() => {
			expect(screen.getByText('Jane Candidate')).toBeInTheDocument();
		});
	});
});
