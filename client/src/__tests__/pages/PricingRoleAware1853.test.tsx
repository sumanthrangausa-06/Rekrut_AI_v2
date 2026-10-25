/**
 * #1853 — /pricing must be role-aware (founder ruling 2026-10-25, Option b).
 *
 * Founder-hit: a signed-in CANDIDATE following 'Upgrade to Pro' landed on
 * recruiter team plans, and no candidate plan existed. The user's
 * expectation: a candidate sees the candidate plans (Free vs Pro), a
 * recruiter sees the team plans, and a logged-out visitor sees both
 * groups clearly labelled by audience.
 *
 * These render tests mock only the network (apiCall) and the auth
 * context — the grouping/filtering under test is the page's real code,
 * fed the real GET /billing/plans response shape.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPage } from '@/pages/pricing';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));
vi.mock('@/contexts/auth-context', () => ({
	useAuth: vi.fn(),
	getDashboardPath: () => '/candidate',
}));
vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));
vi.mock('@/components/SEO', () => ({
	SEO: () => null,
}));

import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);
const mockUseAuth = vi.mocked(useAuth);

const PLANS_RESPONSE = {
	stripeConfigured: true,
	plans: [
		{
			id: 'pro',
			name: 'Pro',
			description: 'For candidates who want every AI career tool unlocked.',
			audience: 'candidate',
			monthlyAmount: 1900,
			yearlyAmount: 19000,
			popular: true,
			highlight: 'For candidates',
			features: ['CV Review'],
			custom: false,
		},
		{
			id: 'starter',
			name: 'Starter',
			description: 'For small teams.',
			audience: 'recruiter',
			monthlyAmount: 2900,
			yearlyAmount: 29000,
			popular: false,
			highlight: 'Lean and fast',
			features: ['3 active job posts'],
			custom: false,
		},
		{
			id: 'growth',
			name: 'Growth',
			description: 'For teams scaling hiring.',
			audience: 'recruiter',
			monthlyAmount: 7900,
			yearlyAmount: 79000,
			popular: true,
			highlight: 'Most popular',
			features: ['Unlimited active jobs'],
			custom: false,
		},
		{
			id: 'enterprise',
			name: 'Enterprise',
			description: 'Custom rollout.',
			audience: 'recruiter',
			monthlyAmount: null,
			yearlyAmount: null,
			popular: false,
			highlight: 'Custom pricing',
			features: ['Custom workflow design'],
			custom: true,
		},
	],
};

// #1859: the caller's subscription state, in the real
// GET /billing/subscription-status response shape. Tests swap this to
// model free / active-Pro / active-recruiter-plan callers.
const FREE_SUBSCRIPTION_STATUS = {
	isPaid: false,
	subscriptionId: null,
	plan: null,
	status: 'inactive',
	stripeLive: null,
	tier: 'free',
	isPro: false,
};
let subscriptionStatus: Record<string, unknown> = FREE_SUBSCRIPTION_STATUS;

function renderPricing() {
	return render(
		<MemoryRouter>
			<PricingPage />
		</MemoryRouter>,
	);
}

describe('#1853 PricingPage role-aware plans', () => {
	beforeEach(() => {
		subscriptionStatus = FREE_SUBSCRIPTION_STATUS;
		mockApiCall.mockReset();
		mockApiCall.mockImplementation(async (path: string) =>
			path === '/billing/subscription-status' ? subscriptionStatus : PLANS_RESPONSE,
		);
		mockUseAuth.mockReset();
	});

	it('signed-in candidate sees Free vs Pro — and no recruiter team plans', async () => {
		mockUseAuth.mockReturnValue({
			user: { id: 1, email: 'cand@example.com', name: 'Cand', role: 'candidate' },
			isRecruiter: false,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(await screen.findByText('Pro')).toBeTruthy();
		expect(screen.getByText('Free')).toBeTruthy();
		expect(screen.getByText('$19')).toBeTruthy();
		expect(screen.queryByText('Starter')).toBeNull();
		expect(screen.queryByText('Growth')).toBeNull();
		expect(screen.queryByText('Enterprise')).toBeNull();
		// The candidate framing, not the teams headline.
		expect(screen.getByText('Free forever. Pro when you need it.')).toBeTruthy();
		// The Free card never claims an account state and never reaches
		// checkout. A signed-in load reads the plans plus the caller's own
		// subscription status (#1859) — and nothing else.
		expect(screen.queryByText('Current plan')).toBeNull();
		expect(screen.getByText('Start checkout')).toBeTruthy();
		expect(
			mockApiCall.mock.calls.every(
				([path]) => path === '/billing/plans' || path === '/billing/subscription-status',
			),
		).toBe(true);
	});

	it('signed-in recruiter sees the team plans only — no candidate Pro', async () => {
		mockUseAuth.mockReturnValue({
			user: { id: 2, email: 'rec@example.com', name: 'Rec', role: 'recruiter' },
			isRecruiter: true,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(await screen.findByText('Starter')).toBeTruthy();
		expect(screen.getByText('Growth')).toBeTruthy();
		expect(screen.getByText('Enterprise')).toBeTruthy();
		expect(screen.queryByText('Pro')).toBeNull();
		expect(screen.getByText('Choose a plan that fits your hiring volume.')).toBeTruthy();
	});

	it('logged-out visitor sees both groups, labelled by audience', async () => {
		mockUseAuth.mockReturnValue({
			user: null,
			isRecruiter: false,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(
			await screen.findByRole('heading', { name: 'For candidates' }),
		).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'For hiring teams' })).toBeTruthy();
		expect(screen.getByText('Pro')).toBeTruthy();
		expect(screen.getByText('Starter')).toBeTruthy();
	});
});

describe('#1859 PricingPage reflects an active subscription on clean load', () => {
	beforeEach(() => {
		subscriptionStatus = FREE_SUBSCRIPTION_STATUS;
		mockApiCall.mockReset();
		mockApiCall.mockImplementation(async (path: string) =>
			path === '/billing/subscription-status' ? subscriptionStatus : PLANS_RESPONSE,
		);
		mockUseAuth.mockReset();
	});

	it('active Pro candidate: Pro card says Current plan, no checkout CTA anywhere', async () => {
		subscriptionStatus = {
			isPaid: true,
			subscriptionId: 'sub_1859',
			plan: 'pro',
			status: 'active',
			stripeLive: null,
			tier: 'pro',
			isPro: true,
		};
		mockUseAuth.mockReturnValue({
			user: { id: 1, email: 'pro@example.com', name: 'Pro Cand', role: 'candidate' },
			isRecruiter: false,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(await screen.findByText('Current plan')).toBeTruthy();
		expect(screen.queryByText('Start checkout')).toBeNull();
	});

	it('active Growth recruiter: Growth card is Current plan, Starter still offers checkout', async () => {
		subscriptionStatus = {
			isPaid: true,
			subscriptionId: 'sub_1859_rec',
			plan: 'growth',
			status: 'active',
			stripeLive: null,
			tier: 'pro',
			isPro: true,
		};
		mockUseAuth.mockReturnValue({
			user: { id: 2, email: 'rec@example.com', name: 'Rec', role: 'recruiter' },
			isRecruiter: true,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(await screen.findByText('Current plan')).toBeTruthy();
		expect(screen.getAllByText('Current plan')).toHaveLength(1);
		expect(screen.getByText('Start checkout')).toBeTruthy();
	});

	it('paid but cancelled candidate: Pro is NOT claimed as current, checkout returns', async () => {
		subscriptionStatus = {
			isPaid: true,
			subscriptionId: 'sub_1859_cancelled',
			plan: 'pro',
			status: 'cancelled',
			stripeLive: null,
			tier: 'free',
			isPro: false,
		};
		mockUseAuth.mockReturnValue({
			user: { id: 3, email: 'gone@example.com', name: 'Gone', role: 'candidate' },
			isRecruiter: false,
		} as ReturnType<typeof useAuth>);

		renderPricing();

		expect(await screen.findByText('Start checkout')).toBeTruthy();
		expect(screen.queryByText('Current plan')).toBeNull();
	});
});
