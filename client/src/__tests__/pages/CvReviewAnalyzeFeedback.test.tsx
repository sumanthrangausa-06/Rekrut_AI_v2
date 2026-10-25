/**
 * #1843 — Clicking "Analyze My CV" must show feedback immediately.
 *
 * Founder-hit: after paying for Pro, clicking Analyze appeared dead. One
 * half of that: handleAnalyze left the page in the idle state for the
 * whole synchronous trigger POST (the 'analyzing' state was only set in
 * startPolling, after the server responded), so on a slow/cold server the
 * click showed no spinner and the button stayed clickable.
 *
 * This test holds the trigger POST unresolved and asserts the analysing
 * UI is already on screen — the user's expectation from the click itself,
 * not from the server's answer.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CVReviewPage } from '@/pages/candidate/cv-review';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

describe('#1843 CVReviewPage analyze click feedback', () => {
	beforeEach(() => {
		mockApiCall.mockReset();
		// Trigger POST never resolves during the test: any feedback the
		// user sees must come from the click, not the response.
		mockApiCall.mockImplementation(() => new Promise(() => {}));
	});

	it('shows the analysing state immediately on click, before the trigger responds', async () => {
		render(
			<MemoryRouter>
				<CVReviewPage />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: /analyze my cv/i }));

		expect(await screen.findByText(/analyzing your cv/i)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /analyze my cv/i })).toBeNull();
	});

	it('leaves the starting state for the upgrade card when the trigger 403s', async () => {
		const err = new Error('Upgrade to Pro to access CV Review') as Error & { code?: string };
		err.code = 'UPGRADE_REQUIRED';
		mockApiCall.mockReset();
		mockApiCall.mockRejectedValue(err);

		render(
			<MemoryRouter>
				<CVReviewPage />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: /analyze my cv/i }));

		expect(await screen.findByRole('heading', { name: /upgrade to pro/i })).toBeTruthy();
		expect(screen.queryByText(/analyzing your cv/i)).toBeNull();
	});
});
