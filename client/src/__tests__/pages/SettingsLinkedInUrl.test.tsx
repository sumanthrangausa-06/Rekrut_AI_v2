import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/pages/settings';

// ── Mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: {
			id: 1,
			name: 'Test User',
			email: 'test@example.com',
			role: 'candidate',
			avatar_url: '',
		},
		logout: vi.fn(),
	}),
}));

vi.mock('@/contexts/theme-context', () => ({
	useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), setTheme: vi.fn() }),
}));

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

function renderWithRouter(component: React.ReactNode) {
	return render(<BrowserRouter>{component}</BrowserRouter>);
}

// ── Test Suite: LinkedIn Profile URL Field (#167) ──────────────────────

describe('SettingsPage — LinkedIn URL Field', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders LinkedIn URL input in profile tab', () => {
		renderWithRouter(<SettingsPage />);

		// The LinkedIn URL field should be visible in the profile form
		expect(screen.getByLabelText(/LinkedIn URL/i)).toBeInTheDocument();
	});

	it('validates LinkedIn URL format on input', async () => {
		renderWithRouter(<SettingsPage />);

		const linkedinInput = screen.getByLabelText(/LinkedIn URL/i);

		// Valid URL should show no error
		fireEvent.change(linkedinInput, { target: { value: 'https://linkedin.com/in/johndoe' } });
		await waitFor(() => {
			expect(screen.queryByText(/Invalid LinkedIn URL/i)).not.toBeInTheDocument();
		});

		// Invalid URL should show error
		fireEvent.change(linkedinInput, { target: { value: 'not-a-url' } });
		await waitFor(() => {
			expect(screen.getByText(/Must be a LinkedIn URL/i)).toBeInTheDocument();
		});
	});

	it('rejects non-linkedin.com URLs', async () => {
		renderWithRouter(<SettingsPage />);

		const linkedinInput = screen.getByLabelText(/LinkedIn URL/i);
		fireEvent.change(linkedinInput, { target: { value: 'https://twitter.com/johndoe' } });

		await waitFor(() => {
			expect(screen.getByText(/Must be a LinkedIn URL/i)).toBeInTheDocument();
		});
	});

	it('accepts linkedin.com/in/ vanity URLs', async () => {
		renderWithRouter(<SettingsPage />);

		const linkedinInput = screen.getByLabelText(/LinkedIn URL/i);
		const validUrls = [
			'https://linkedin.com/in/johndoe',
			'https://www.linkedin.com/in/john-doe-123',
			'linkedin.com/in/johndoe',
		];

		for (const url of validUrls) {
			fireEvent.change(linkedinInput, { target: { value: url } });
			await waitFor(() => {
				expect(screen.queryByText(/Invalid LinkedIn URL/i)).not.toBeInTheDocument();
			});
		}
	});

	it('shows re-sync button when LinkedIn is connected', async () => {
		const { apiCall } = await import('@/lib/api');
		vi.mocked(apiCall)
			.mockResolvedValueOnce({
				// loadSettings (/settings)
				profile: { bio: '', location: '', linkedin_url: '' },
				notifications: {},
				privacy: {},
			})
			.mockResolvedValueOnce({
				// loadBilling (/billing/subscription-status)
				isPaid: false,
				subscriptionId: null,
				plan: null,
				status: 'inactive',
			})
			.mockResolvedValueOnce({
				// loadConnections (/auth/oauth/connections)
				connections: [
					{
						provider: 'linkedin',
						connected_at: '2026-08-28T12:00:00Z',
						email: 'john@linkedin.com',
						last_sync: '2026-08-28T12:00:00Z',
					},
				],
				has_password: true,
			});

		renderWithRouter(<SettingsPage />);

		// Wait for initial load to complete
		await waitFor(() => {
			expect(screen.getByLabelText(/LinkedIn URL/i)).toBeInTheDocument();
		});

		// Navigate to account tab to see connections
		const accountTab = screen.getAllByText(/Account/i).find((el) => el.tagName === 'BUTTON');
		if (!accountTab) throw new Error('Account tab not found');
		fireEvent.click(accountTab);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Re-sync/i })).toBeInTheDocument();
		});
	});

	it('shows last synced timestamp for LinkedIn connection', async () => {
		const { apiCall } = await import('@/lib/api');
		vi.mocked(apiCall)
			.mockResolvedValueOnce({
				// loadSettings (/settings)
				profile: { bio: '', location: '', linkedin_url: '' },
				notifications: {},
				privacy: {},
			})
			.mockResolvedValueOnce({
				// loadBilling (/billing/subscription-status)
				isPaid: false,
				subscriptionId: null,
				plan: null,
				status: 'inactive',
			})
			.mockResolvedValueOnce({
				// loadConnections (/auth/oauth/connections)
				connections: [
					{
						provider: 'linkedin',
						connected_at: '2026-08-28T12:00:00Z',
						email: 'john@linkedin.com',
						last_sync: '2026-08-28T14:30:00Z',
					},
				],
				has_password: true,
			});

		renderWithRouter(<SettingsPage />);

		// Wait for initial load
		await waitFor(() => {
			expect(screen.getByLabelText(/LinkedIn URL/i)).toBeInTheDocument();
		});

		const accountTab = screen.getAllByText(/Account/i).find((el) => el.tagName === 'BUTTON');
		if (!accountTab) throw new Error('Account tab not found');
		fireEvent.click(accountTab);

		await waitFor(() => {
			expect(screen.getByText(/Last sync:/i)).toBeInTheDocument();
		});
	});

	it('displays LinkedIn URL as clickable link when set', () => {
		renderWithRouter(<SettingsPage />);

		// Fill in a LinkedIn URL
		const linkedinInput = screen.getByLabelText(/LinkedIn URL/i);
		fireEvent.change(linkedinInput, { target: { value: 'https://linkedin.com/in/johndoe' } });

		// There should be a link to view the profile
		const link = screen.getByRole('link', { name: /View LinkedIn profile/i });
		expect(link).toHaveAttribute('href', 'https://linkedin.com/in/johndoe');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});
});
