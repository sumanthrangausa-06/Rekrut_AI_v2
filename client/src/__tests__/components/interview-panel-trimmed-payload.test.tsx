/**
 * S-087 (#790): InterviewPanel renders from the minimised list payload.
 *
 * The sessions list no longer ships `config` — the two values the panel
 * needs arrive as server-derived top-level scalars (`overall_score`,
 * `observer_enabled`). These tests pin the panel's rendering against that
 * trimmed shape: score badge and observer state must work with no `config`
 * key on the row at all.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewPanel } from '@/components/domain/InterviewPanel';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

beforeEach(() => {
	vi.clearAllMocks();
	mockApiCall.mockImplementation(async () => ({
		success: true,
		sessions: [
			{
				id: 5,
				type: 'screening',
				status: 'completed',
				source: 'interview_session',
				created_at: '2026-10-01T10:00:00.000Z',
				overall_score: 91,
				observer_enabled: true,
			},
			{
				id: 6,
				type: 'human',
				status: 'invited',
				source: 'interview_session',
				created_at: '2026-10-02T10:00:00.000Z',
				overall_score: null,
				observer_enabled: false,
			},
			{
				id: 7,
				type: 'human',
				status: 'in_progress',
				source: 'interview_session',
				created_at: '2026-10-03T10:00:00.000Z',
				overall_score: null,
				observer_enabled: true,
			},
		],
	}));
});

describe('S-087: InterviewPanel with the trimmed list payload', () => {
	it('renders the score badge from the derived overall_score scalar (no config on the row)', async () => {
		render(<InterviewPanel candidateId={42} applicationId={7} onViewReport={() => {}} />);

		expect(await screen.findByText('91/100')).toBeTruthy();
	});

	it('renders the observer state from the derived observer_enabled scalar', async () => {
		render(<InterviewPanel candidateId={42} applicationId={7} onViewReport={() => {}} />);

		expect(await screen.findByText('Observer on')).toBeTruthy();
		// The not-yet-completed human session without the observer shows the toggle.
		expect(await screen.findByRole('button', { name: /ai observer/i })).toBeTruthy();
	});
});
