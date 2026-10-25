import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #889 — the invented recruiter inbox is retired.
// Honest equivalent of a route-redirect test in this repo's client pattern:
// render the REAL App (its BrowserRouter + guards) at the retired URL, with
// only the network layer (`apiCall`) mocked — as a signed-in recruiter.
// Before the fix this renders RecruiterCommunicationsPage with invented
// messages (Alex Johnson / Sarah Chen / Mike Williams). After the fix the
// route is a <Navigate> to the real chat home, /recruiter/chat.

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/api')>();
	return {
		...actual,
		apiCall: vi.fn((url: string) => {
			if (url === '/auth/me') {
				return Promise.resolve({
					user: {
						id: 1,
						name: 'Test Recruiter',
						email: 'recruiter@example.com',
						role: 'recruiter',
						company_id: 10,
					},
				});
			}
			if (url === '/billing/tier') return Promise.resolve({ tier: 'free' });
			if (url === '/company/profile') {
				return Promise.resolve({ company: { owner_id: 1 } });
			}
			if (url.includes('conversations')) {
				return Promise.resolve({ conversations: [], messages: [] });
			}
			if (url.includes('notifications')) {
				return Promise.resolve({ notifications: [], unreadCount: 0 });
			}
			return Promise.resolve({});
		}),
	};
});

import App from '@/App';

describe('/recruiter/communications — invented inbox retired (#889)', () => {
	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('rekrutai_token', 'test-token');
		window.history.pushState({}, '', '/recruiter/communications');
	});

	it('redirects to the real chat home and never renders the invented messages', { timeout: 15000 }, async () => {
		render(<App />);

		await waitFor(
			() => {
				expect(window.location.pathname).toBe('/recruiter/chat');
			},
			{ timeout: 5000 },
		);

		expect(screen.queryByText('Alex Johnson')).not.toBeInTheDocument();
		expect(screen.queryByText('Sarah Chen')).not.toBeInTheDocument();
		expect(screen.queryByText('Mike Williams')).not.toBeInTheDocument();
		expect(
			screen.queryByText('Application for Senior Frontend Developer'),
		).not.toBeInTheDocument();
	});
});
