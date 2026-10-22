import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateProfilePage } from '@/pages/candidate/profile';

// #1608 — Uploaded profile picture not displayed (header/dropdown stale).
// User complaint (JT-M2): candidate uploads a picture on the Profile page,
// the page says "Photo updated", but the header/dropdown keep showing the
// old/default avatar for the rest of the session. Root cause (STOP 1,
// Scout 2026-10-21): the Profile page updated only its local state and
// never called refreshUser(), so the auth context — which the header
// reads user.avatar_url from — was never refreshed in-session.

const NEW_PHOTO_URL = 'https://storage.example/photos/new-avatar-1608.jpg';
const OLD_PHOTO_URL = 'https://storage.example/photos/old-avatar.jpg';

const refreshUserSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
			avatar_url: OLD_PHOTO_URL,
		},
		isAuthenticated: true,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		loading: false,
		isRecruiter: false,
		refreshUser: refreshUserSpy,
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

function mockProfileLoad() {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url === '/candidate/profile') {
			return {
				success: true,
				profile: {
					name: 'Test User',
					email: 'test@example.com',
					avatar_url: OLD_PHOTO_URL,
				},
				experience: [],
				education: [],
				skills: [],
				certifications: [],
				projects: [],
				activities: [],
				suggested_connections: [],
				job_alerts: [],
			} as never;
		}
		if (url === '/candidate/profile/photo') {
			return { success: true, photo_url: NEW_PHOTO_URL } as never;
		}
		return {} as never;
	});
}

function renderPage() {
	return render(
		<BrowserRouter>
			<CandidateProfilePage />
		</BrowserRouter>,
	);
}

async function uploadPhoto(container: HTMLElement) {
	const input = container.querySelector<HTMLInputElement>(
		'input[type="file"][accept="image/*"]',
	);
	if (!input) throw new Error('avatar file input not found');
	const file = new File(['fake-image-bytes'], 'me.png', { type: 'image/png' });
	fireEvent.change(input, { target: { files: [file] } });
}

describe('CandidateProfilePage — avatar upload refreshes auth context (#1608, JT-M2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		refreshUserSpy.mockClear();
		mockProfileLoad();
	});

	it('calls refreshUser() after a successful photo upload so the header avatar updates in-session', async () => {
		const { container } = renderPage();

		// Profile header is visible once loading completes.
		expect(await screen.findByRole('heading', { name: /Test User/i })).toBeInTheDocument();

		await uploadPhoto(container);

		// The upload itself succeeded — the page confirms it and shows the new picture locally.
		expect(await screen.findByText('Photo updated')).toBeInTheDocument();

		// THE #1608 ASSERTION: the auth context must be refreshed so the header /
		// dropdown (reading user.avatar_url from that context) show the new
		// picture immediately, without reload or re-login.
		await waitFor(() => {
			expect(refreshUserSpy).toHaveBeenCalled();
		});
	});

	it('does NOT call refreshUser() when the upload fails, and shows the real error (FR-M4)', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url === '/candidate/profile') {
				return {
					success: true,
					profile: {
						name: 'Test User',
						email: 'test@example.com',
						avatar_url: OLD_PHOTO_URL,
					},
					experience: [],
					education: [],
					skills: [],
					certifications: [],
					projects: [],
					activities: [],
					suggested_connections: [],
					job_alerts: [],
				} as never;
			}
			if (url === '/candidate/profile/photo') {
				throw new Error('storage unavailable');
			}
			return {} as never;
		});

		const { container } = renderPage();
		expect(await screen.findByRole('heading', { name: /Test User/i })).toBeInTheDocument();

		await uploadPhoto(container);

		expect(await screen.findByText('Failed to upload photo')).toBeInTheDocument();
		expect(refreshUserSpy).not.toHaveBeenCalled();
	});
});
