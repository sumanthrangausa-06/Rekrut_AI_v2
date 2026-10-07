import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralAssessmentPage } from '@/pages/referral-assessment';

// Mock the API module
vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

// Mock the auth context
vi.mock('@/contexts/auth-context', () => ({
	useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);
const mockUseAuth = vi.mocked(useAuth);

const PREVIEW = {
	job_title: 'QA Engineer',
	company_name: 'Acme Inc',
	company_trustscore: { score: 82, tier: 'excellent' },
	assessment_title: 'QA Skills Assessment',
	assessment_description: 'Role-specific QA evaluation.',
	dimensions: ['technical', 'scenario'],
	question_count: 15,
	time_limit_minutes: 45,
	due_date: new Date(Date.now() + 864e5).toISOString(),
};

function renderAt(token: string, auth: { isAuthenticated: boolean; user?: any }) {
	mockUseAuth.mockReturnValue({
		isAuthenticated: auth.isAuthenticated,
		loading: false,
		user: auth.user ?? null,
	} as any);
	return render(
		<MemoryRouter initialEntries={[`/r/${token}`]}>
			<Routes>
				<Route path="/r/:token" element={<ReferralAssessmentPage />} />
				<Route path="/login" element={<div>login page</div>} />
				<Route path="/register" element={<div>register page</div>} />
				<Route path="/candidate/job-assessment/:id" element={<div>take page</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('ReferralAssessmentPage (#349 task 2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('logged-out: shows preview with dimensions, trust score, and auth CTAs', async () => {
		mockApiCall.mockResolvedValue(PREVIEW);
		renderAt('tok123', { isAuthenticated: false });

		expect(await screen.findByText('QA Skills Assessment')).toBeInTheDocument();
		expect(screen.getByText(/Acme Inc.*QA Engineer/)).toBeInTheDocument();
		expect(screen.getByText(/TrustScore 82/)).toBeInTheDocument();
		expect(screen.getByText('technical')).toBeInTheDocument();
		expect(screen.getByText('scenario')).toBeInTheDocument();
		expect(screen.getByText('Create account to start')).toBeInTheDocument();
		expect(screen.getByText('Log in')).toBeInTheDocument();
		// AI disclosure present
		expect(screen.getByText(/scored by AI and reviewed by a human/i)).toBeInTheDocument();
	});

	it('logged-out: auth links carry returnTo back to the referral', async () => {
		mockApiCall.mockResolvedValue(PREVIEW);
		renderAt('tok123', { isAuthenticated: false });

		const signup = await screen.findByText('Create account to start');
		expect(signup.closest('a')?.getAttribute('href')).toBe('/register?returnTo=%2Fr%2Ftok123');
		const login = screen.getByText('Log in');
		expect(login.closest('a')?.getAttribute('href')).toBe('/login?returnTo=%2Fr%2Ftok123');
	});

	it('logged-in: shows Start assessment and claims on click', async () => {
		mockApiCall.mockImplementation((url: string, opts?: any) => {
			if (url.includes('/preview')) return Promise.resolve(PREVIEW);
			if (url.includes('/refer/claim')) {
				expect(opts.body.token).toBe('tok123');
				return Promise.resolve({ redirect_url: '/candidate/job-assessment/7' });
			}
			return Promise.reject(new Error('unexpected'));
		});
		renderAt('tok123', {
			isAuthenticated: true,
			user: { id: 9, email: 'cand@example.com' },
		});

		const start = await screen.findByText('Start assessment');
		await userEvent.click(start);
		await waitFor(() => expect(screen.getByText('take page')).toBeInTheDocument());
	});

	it('logged-in with mismatched email: surfaces the claim 403 cleanly', async () => {
		mockApiCall.mockImplementation((url: string) => {
			if (url.includes('/preview')) return Promise.resolve(PREVIEW);
			const err = new Error('This referral was issued to a different email') as any;
			err.code = 'EMAIL_MISMATCH';
			return Promise.reject(err);
		});
		renderAt('tok123', {
			isAuthenticated: true,
			user: { id: 9, email: 'other@example.com' },
		});

		const start = await screen.findByText('Start assessment');
		await userEvent.click(start);
		expect(
			await screen.findByText(/issued to a different email/i),
		).toBeInTheDocument();
	});

	it('invalid token (404): shows invalid-link messaging', async () => {
		mockApiCall.mockRejectedValue(new Error('Referral not found'));
		renderAt('badtoken', { isAuthenticated: false });

		expect(await screen.findByText(/invalid referral link/i)).toBeInTheDocument();
	});

	it('expired token (410): shows expired messaging', async () => {
		const err = new Error('Referral expired') as any;
		err.code = 'REFERRAL_EXPIRED';
		mockApiCall.mockRejectedValue(err);
		renderAt('oldtoken', { isAuthenticated: false });

		expect(await screen.findByText(/link has expired/i)).toBeInTheDocument();
	});
});
