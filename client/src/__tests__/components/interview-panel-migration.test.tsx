/**
 * S-062 (#712): Migrate InterviewPanel session creation to the new endpoint.
 *
 *   AC-1: "Start human interview" calls POST /interviews/sessions (new S-001
 *         endpoint) instead of POST /interviews/interview-sessions (old).
 *   AC-2: Request body still carries type/candidate_id/application_id.
 *   AC-3: Success message + list reload behavior unchanged.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewPanel } from '@/components/domain/InterviewPanel';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

beforeEach(() => {
	vi.clearAllMocks();
	// Default: empty session list so the panel renders the action buttons.
	mockApiCall.mockImplementation(async (url: string, options?: { method?: string }) => {
		if (!options?.method || options.method === 'GET') {
			return { success: true, sessions: [] };
		}
		return { success: true, session: { id: 1 } };
	});
});

function renderPanel() {
	return render(
		<InterviewPanel candidateId={42} applicationId={7} onViewReport={() => {}} />,
	);
}

describe('S-062: InterviewPanel session creation endpoint', () => {
	it('AC-1: POSTs to the NEW /interviews/sessions endpoint (not the old one)', async () => {
		renderPanel();

		const btn = await screen.findByRole('button', { name: /start human interview/i });
		fireEvent.click(btn);

		await waitFor(() => {
			const postCalls = mockApiCall.mock.calls.filter(
				([, options]) => (options as { method?: string } | undefined)?.method === 'POST',
			);
			expect(postCalls.length).toBeGreaterThan(0);
		});

		const postCalls = mockApiCall.mock.calls.filter(
			([, options]) => (options as { method?: string } | undefined)?.method === 'POST',
		);
		const urls = postCalls.map(([url]) => url as string);
		expect(urls).toContain('/interviews/sessions');
		expect(urls).not.toContain('/interviews/interview-sessions');
	});

	it('AC-2: request body carries type, candidate_id and application_id', async () => {
		renderPanel();

		const btn = await screen.findByRole('button', { name: /start human interview/i });
		fireEvent.click(btn);

		await waitFor(() => {
			const postCalls = mockApiCall.mock.calls.filter(
				([url, options]) =>
					url === '/interviews/sessions' &&
					(options as { method?: string } | undefined)?.method === 'POST',
			);
			expect(postCalls.length).toBeGreaterThan(0);
		});

		const [, options] = mockApiCall.mock.calls.find(
			([url, opts]) =>
				url === '/interviews/sessions' &&
				(opts as { method?: string } | undefined)?.method === 'POST',
		)! as [string, { body?: Record<string, unknown> }];
		expect(options.body).toMatchObject({
			type: 'human',
			candidate_id: 42,
			application_id: 7,
		});
	});

	it('AC-3: shows the scheduled confirmation after success', async () => {
		renderPanel();

		const btn = await screen.findByRole('button', { name: /start human interview/i });
		fireEvent.click(btn);

		await screen.findByText(/human interview scheduled/i);
	});
});
