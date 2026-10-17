import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #1223 (D10) — Company owner lands on "Awaiting Approval" after login.
// Quinn's verified shape (QA 2026-10-15): the user IS companies.owner_id,
// zero join requests exist, and the DB holds users.company_id — but the
// POST /auth/login response user object carries NO company_id
// (routes/auth.js login response), the client sets that user verbatim, and
// its background /company/profile patch kept only is_company_owner,
// discarding company.id. Both classifiers (isPendingApproval in
// auth-context, getDashboardPath in lib/api) treated
// `recruiter && !company_id` as pending, with no owner bypass.
// A reload bootstraps via /auth/me (which DOES return company_id), which
// is why direct URLs bypassed the wall.
//
// These tests drive the REAL AuthProvider with only apiCall mocked, using
// the exact login payload shape the server sends today.

let loginUser: Record<string, unknown>;
let profileShouldFail = false;

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>();
	return {
		...actual,
		apiCall: vi.fn((url: string) => {
			if (url === '/auth/login') {
				return Promise.resolve({
					success: true,
					user: loginUser,
					accessToken: 'access-token',
					refreshToken: 'refresh-token',
					token: 'access-token',
				});
			}
			if (url === '/billing/tier') return Promise.resolve({ tier: 'free' });
			if (url === '/company/profile') {
				if (profileShouldFail) {
					return Promise.reject(new Error('No company associated with this account'));
				}
				return Promise.resolve({ company: { id: 1, owner_id: 2 } });
			}
			return Promise.resolve({});
		}),
	};
});

import { AuthProvider, getDashboardPath, useAuth } from '@/contexts/auth-context';

let auth: ReturnType<typeof useAuth>;

function Probe() {
	auth = useAuth();
	return (
		<div>
			<span data-testid="pending">{String(auth.isPendingApproval)}</span>
			<span data-testid="company-id">{String(auth.user?.company_id ?? 'null')}</span>
			<span data-testid="owner">{String(auth.user?.is_company_owner ?? 'null')}</span>
			<span data-testid="path">{auth.user ? getDashboardPath(auth.user) : 'none'}</span>
		</div>
	);
}

describe('#1223 owner post-login routing', () => {
	beforeEach(() => {
		localStorage.clear();
		profileShouldFail = false;
	});

	it('company owner whose login payload omits company_id is NOT pending approval', async () => {
		// Exact server login shape for Quinn's owner (id 2, company 1):
		// no company_id field at all.
		loginUser = {
			id: 2,
			email: 'recruiter@qacorp.rekrutai.test',
			name: 'QA Owner',
			role: 'employer',
			is_paid: false,
			avatar_url: null,
		};
		render(
			<AuthProvider>
				<Probe />
			</AuthProvider>,
		);

		await act(async () => {
			await auth.login('recruiter@qacorp.rekrutai.test', 'password123');
		});

		await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('false'));
		expect(screen.getByTestId('path').textContent).toBe('/recruiter');
		expect(screen.getByTestId('company-id').textContent).toBe('1');
		expect(screen.getByTestId('owner').textContent).toBe('true');
	});

	it('genuine pending join-request user STILL sees Awaiting Approval', async () => {
		loginUser = {
			id: 3,
			email: 'joiner@qacorp.rekrutai.test',
			name: 'Pending Joiner',
			role: 'recruiter',
			company_id: null,
			is_paid: false,
			avatar_url: null,
		};
		profileShouldFail = true;
		render(
			<AuthProvider>
				<Probe />
			</AuthProvider>,
		);

		await act(async () => {
			await auth.login('joiner@qacorp.rekrutai.test', 'password123');
		});

		await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('true'));
		expect(screen.getByTestId('path').textContent).toBe('/recruiter/pending-approval');
	});

	it('getDashboardPath never walls a known company owner, even without company_id', () => {
		expect(
			getDashboardPath({
				id: 2,
				email: 'recruiter@qacorp.rekrutai.test',
				name: 'QA Owner',
				role: 'employer',
				company_id: null,
				is_company_owner: true,
			}),
		).toBe('/recruiter');
	});
});
