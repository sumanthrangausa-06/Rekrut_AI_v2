/**
 * #1407 — CV Review poll must not spin forever.
 *
 * Before: startPolling in cv-review.tsx polled GET /cv/analysis/:id every
 * 2s with no cap — a row stuck in 'pending' (e.g. the server process died
 * mid-analysis, leaving a dangling pending row) spun the UI indefinitely.
 *
 * After: polling is capped (30 polls ≈ 60s — the page itself says analysis
 * "usually takes 10–30 seconds" and the server cascade caps at 12s), then
 * the truthful 'failed' state is surfaced and polling stops.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CVReviewPage } from '@/pages/candidate/cv-review';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

function getCallCount() {
	return mockApiCall.mock.calls.filter(([url]) =>
		String(url).includes('/candidate/cv/analysis/'),
	).length;
}

describe('#1407 CVReviewPage poll timeout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockApiCall.mockReset();
		mockApiCall.mockImplementation(async (url: string) => {
			if (url === '/candidate/cv/analyze') {
				return { success: true, analysis_id: 7, status: 'completed' };
			}
			// The analysis row never leaves 'pending'.
			return {
				success: true,
				analysis: {
					id: 7,
					status: 'pending',
					overall_score: null,
					section_scores: null,
					recommendations: null,
				},
			};
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stops polling and surfaces the truthful failed state instead of spinning forever', async () => {
		render(
			<MemoryRouter>
				<CVReviewPage />
			</MemoryRouter>,
		);

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /analyze my cv/i }));
		});
		expect(screen.getByText(/analyzing your cv/i)).toBeInTheDocument();

		// Advance well past any reasonable poll cap (5 minutes of polling).
		for (let i = 0; i < 150; i++) {
			await act(async () => {
				vi.advanceTimersByTime(2000);
			});
		}

		expect(screen.getByText(/analysis failed/i)).toBeInTheDocument();
		expect(screen.getByText(/timed out/i)).toBeInTheDocument();
		expect(screen.queryByText(/analyzing your cv/i)).not.toBeInTheDocument();

		// Polling has actually stopped: no further GETs after the cap.
		const callsAtTimeout = getCallCount();
		expect(callsAtTimeout).toBeLessThanOrEqual(31);
		for (let i = 0; i < 10; i++) {
			await act(async () => {
				vi.advanceTimersByTime(2000);
			});
		}
		expect(getCallCount()).toBe(callsAtTimeout);
	});
});
