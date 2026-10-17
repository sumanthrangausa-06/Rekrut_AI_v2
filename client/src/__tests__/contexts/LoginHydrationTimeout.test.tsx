import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #1259 (follow-up from reviewer F1 on PR #1257 / #1223) — the #1223 fix
// makes login() await the /company/profile membership hydration before
// the first setUser for recruiter roles. That await had NO timeout: a
// never-resolving profile request would hang the login transition
// forever. login() must bound the await and, on expiry, fall back to the
// existing genuine-pending behaviour (same state the failure-fast path
// produces), while a late profile resolution still patches membership
// in via the background path.
//
// These tests drive the REAL AuthProvider with only apiCall mocked.

let resolveProfile: ((value: { company: { id: number; owner_id: number } }) => void) | null =
	null;

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>();
	return {
		...actual,
		apiCall: vi.fn((url: string) => {
			if (url === '/auth/login') {
				return Promise.resolve({
					success: true,
					user: {
						id: 2,
						email: 'recruiter@qacorp.rekrutai.test',
						name: 'QA Owner',
						role: 'employer',
						is_paid: false,
						avatar_url: null,
					},
					accessToken: 'access-token',
					refreshToken: 'refresh-token',
					token: 'access-token',
				});
			}
			if (url === '/billing/tier') return Promise.resolve({ tier: 'free' });
			if (url === '/company/profile') {
				// Never resolves on its own — the test controls if/when it settles.
				return new Promise((resolve) => {
					resolveProfile = resolve;
				});
			}
			return Promise.resolve({});
		}),
	};
});

import { AuthProvider, useAuth } from '@/contexts/auth-context';

let auth: ReturnType<typeof useAuth>;

function Probe() {
	auth = useAuth();
	return (
		<div>
			<span data-testid="pending">{String(auth.isPendingApproval)}</span>
			<span data-testid="company-id">{String(auth.user?.company_id ?? 'null')}</span>
			<span data-testid="owner">{String(auth.user?.is_company_owner ?? 'null')}</span>
		</div>
	);
}

describe('#1259 login hydration timeout', () => {
	beforeEach(() => {
		localStorage.clear();
		resolveProfile = null;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('login() settles into genuine-pending behaviour when /company/profile never resolves', async () => {
		render(
			<AuthProvider>
				<Probe />
			</AuthProvider>,
		);

		let settled = false;
		await act(async () => {
			void auth
				.login('recruiter@qacorp.rekrutai.test', 'password123')
				.then(() => {
					settled = true;
				});
		});
		// Profile request is hung: without a bound, login() can never settle.
		expect(settled).toBe(false);

		await act(async () => {
			vi.advanceTimersByTime(5000);
		});

		// Within the bound, login() settles and the user lands in the same
		// state the failure-fast path produces today: set, but pending
		// (company_id still unknown) — NOT an error state, NOT a hang.
		expect(settled).toBe(true);
		expect(screen.getByTestId('pending').textContent).toBe('true');
		expect(screen.getByTestId('company-id').textContent).toBe('null');
	});

	it('a profile response arriving after the timeout still patches membership in', async () => {
		render(
			<AuthProvider>
				<Probe />
			</AuthProvider>,
		);

		await act(async () => {
			void auth.login('recruiter@qacorp.rekrutai.test', 'password123');
		});
		await act(async () => {
			vi.advanceTimersByTime(5000);
		});
		expect(screen.getByTestId('pending').textContent).toBe('true');

		// The hung request finally lands — background hydration applies it,
		// exactly like the bootstrap/register patchCompanyProfile behaviour.
		await act(async () => {
			resolveProfile?.({ company: { id: 1, owner_id: 2 } });
		});

		expect(screen.getByTestId('pending').textContent).toBe('false');
		expect(screen.getByTestId('company-id').textContent).toBe('1');
		expect(screen.getByTestId('owner').textContent).toBe('true');
	});
});
