/**
 * #1227 — LinkedIn Optimizer tips call must hit the real server route.
 *
 * Server: GET /api/linkedin/tips/:candidateId
 *   (routes/profile-enhancement.js, behind authMiddleware +
 *    requireOwnCandidate — the :candidateId must be the caller's own id).
 * apiCall (client/src/lib/api.ts) prepends `/api`, so the page must call
 * `/linkedin/tips/${userId}` with the signed-in user's id.
 *
 * Before the fix the page called '/profile-enhancement/linkedin-tips'
 * → wire GET /api/profile-enhancement/linkedin-tips → 404.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedInOptimizerPage } from '@/pages/candidate/linkedin-optimizer';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);
const mockUseAuth = vi.mocked(useAuth);

const TIPS_RESULT = {
	success: true,
	profileStatus: {
		connected: true,
		completenessScore: 72,
		missingSections: ['skills'],
		linkedinUrl: 'https://www.linkedin.com/in/example',
	},
	tips: [
		{
			category: 'headline',
			title: 'Sharpen your headline',
			description: 'Say what you do and who for.',
			priority: 'high' as const,
			actionable: 'Rewrite your headline today.',
		},
	],
	headlineSuggestions: ['Data Analyst | SQL | BI'],
	aboutSectionTemplate: 'About template text',
	weeklyActionPlan: [{ day: 'Monday', action: 'Post once' }],
	summary: 'Your profile is mostly complete.',
};

function renderPage(user: { id: number } | null) {
	mockUseAuth.mockReturnValue({ user } as never);
	mockApiCall.mockResolvedValue(TIPS_RESULT as never);
	return render(<LinkedInOptimizerPage />);
}

describe('#1227 LinkedIn Optimizer tips path', () => {
	beforeEach(() => vi.clearAllMocks());

	it('requests the canonical route with the signed-in user id', async () => {
		renderPage({ id: 42 });

		expect(await screen.findByText('Sharpen your headline')).toBeInTheDocument();
		expect(mockApiCall).toHaveBeenCalledWith('/linkedin/tips/42');
		expect(mockApiCall).not.toHaveBeenCalledWith('/profile-enhancement/linkedin-tips');
		// Constructed wire URL (apiCall prepends /api) is the real route.
		const arg = mockApiCall.mock.calls[0]?.[0] as string;
		expect(`/api${arg}`).toBe('/api/linkedin/tips/42');
	});

	it('does not call the tips route until the own user id is known (ownership guard)', async () => {
		renderPage(null);

		// Give any effect a chance to run; no request may be fired without
		// an id, because requireOwnCandidate 403s/400s any other id.
		await new Promise((r) => setTimeout(r, 50));
		expect(mockApiCall).not.toHaveBeenCalled();
	});
});
