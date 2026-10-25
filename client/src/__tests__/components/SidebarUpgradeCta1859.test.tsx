/**
 * #1859 — the sidebar "Upgrade to Pro" CTA must hide for a candidate who
 * already has Pro. The sidebar previously read `user.subscription_tier` /
 * `user.plan`, fields that never exist on the auth user, so the CTA
 * showed for everyone. The real field is `user.subscriptionTier`
 * (populated by the auth context from GET /billing/tier).
 *
 * User journey: a Pro candidate opens any dashboard page and must NOT be
 * asked to upgrade to what they already pay for; a free candidate still
 * sees the upgrade door.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/sidebar';

const authState = vi.hoisted(() => ({
	user: null as Record<string, unknown> | null,
	isRecruiter: false,
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: authState.user,
		isRecruiter: authState.isRecruiter,
		isAuthenticated: !!authState.user,
		loading: false,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		refreshSubscription: vi.fn(),
		refreshUser: vi.fn(),
	}),
}));

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(async () => ({ success: true, requests: [] })),
}));

function renderSidebar() {
	return render(
		<MemoryRouter initialEntries={['/candidate']}>
			<Sidebar open onClose={() => {}} />
		</MemoryRouter>,
	);
}

describe('#1859 sidebar Upgrade to Pro CTA', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authState.isRecruiter = false;
	});

	it('free candidate sees the Upgrade to Pro CTA', () => {
		authState.user = {
			id: 11,
			name: 'Free Candidate',
			email: 'free@example.com',
			role: 'candidate',
			subscriptionTier: 'free',
		};
		renderSidebar();
		expect(screen.getByText('Upgrade to Pro')).toBeTruthy();
	});

	it('Pro candidate does NOT see the Upgrade to Pro CTA', () => {
		authState.user = {
			id: 12,
			name: 'Pro Candidate',
			email: 'pro@example.com',
			role: 'candidate',
			subscriptionTier: 'pro',
		};
		renderSidebar();
		expect(screen.queryByText('Upgrade to Pro')).toBeNull();
	});
});
