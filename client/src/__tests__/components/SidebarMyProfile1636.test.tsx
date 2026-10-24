import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/sidebar';

// #1636 — JT-M1 on the mobile sidebar (follow-up to #1607; PRD
// prd-job-board-and-profile.md FR-M1: "Same on mobile navigation").
// User journey, written from the candidate's expectations:
// a candidate opens the sidebar (the mobile drawer), expects to SEE who
// they are signed in as (their name + avatar), expects an entry actually
// labelled "My Profile", taps it, and lands on the Profile page.
// On current dev the sidebar has no "My Profile" label, no Avatar and no
// identity block at all — only a nav item called "Profile" — so the
// candidate must guess. The recruiter layout must offer the same door,
// to /recruiter/company (the header dropdown's recruiter profile path).

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

function renderSidebar(initialPath: string) {
	return render(
		<MemoryRouter initialEntries={[initialPath]}>
			<Routes>
				<Route
					path="*"
					element={
						<>
							<Sidebar open onClose={() => {}} />
						</>
					}
				/>
			</Routes>
			<Routes>
				<Route path="/candidate" element={<div>Candidate Home</div>} />
				<Route path="/recruiter" element={<div>Recruiter Home</div>} />
				<Route path="/candidate/profile" element={<div>Candidate Profile Page</div>} />
				<Route path="/recruiter/company" element={<div>Recruiter Company Page</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('#1636 sidebar My Profile (JT-M1, mobile navigation)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('candidate: opening the sidebar shows their name, avatar and a My Profile entry to /candidate/profile', () => {
		authState.isRecruiter = false;
		authState.user = {
			id: 7,
			name: 'Journey Candidate',
			email: 'journey@example.com',
			role: 'candidate',
			avatar_url: 'https://example.com/journey-avatar.png',
		};
		renderSidebar('/candidate');

		// Identity block: the user sees who they are signed in as.
		expect(screen.getByText('Journey Candidate')).toBeInTheDocument();
		expect(screen.getByText('journey@example.com')).toBeInTheDocument();
		const avatarImg = document.querySelector('img[src="https://example.com/journey-avatar.png"]');
		expect(avatarImg).not.toBeNull();

		// An entry actually labelled "My Profile" (not only "Profile").
		const myProfile = screen.getByRole('link', { name: 'My Profile' });
		expect(myProfile).toHaveAttribute('href', '/candidate/profile');
	});

	it('candidate: tapping My Profile lands on the Profile page', async () => {
		authState.isRecruiter = false;
		authState.user = {
			id: 7,
			name: 'Journey Candidate',
			email: 'journey@example.com',
			role: 'candidate',
			avatar_url: 'https://example.com/journey-avatar.png',
		};
		renderSidebar('/candidate');

		fireEvent.click(screen.getByRole('link', { name: 'My Profile' }));
		expect(await screen.findByText('Candidate Profile Page')).toBeInTheDocument();
	});

	it('candidate: tapping the identity block also lands on the Profile page', async () => {
		authState.isRecruiter = false;
		authState.user = {
			id: 7,
			name: 'Journey Candidate',
			email: 'journey@example.com',
			role: 'candidate',
			avatar_url: 'https://example.com/journey-avatar.png',
		};
		renderSidebar('/candidate');

		// Accessible name carries WHOSE profile (independent review, #1636).
		fireEvent.click(screen.getByRole('link', { name: 'Go to my profile, Journey Candidate' }));
		expect(await screen.findByText('Candidate Profile Page')).toBeInTheDocument();
	});

	it('recruiter: sidebar shows their identity and My Profile goes to /recruiter/company', async () => {
		authState.isRecruiter = true;
		authState.user = {
			id: 9,
			name: 'Journey Recruiter',
			email: 'recruiter@example.com',
			role: 'recruiter',
			avatar_url: 'https://example.com/recruiter-avatar.png',
		};
		renderSidebar('/recruiter');

		expect(screen.getByText('Journey Recruiter')).toBeInTheDocument();
		const myProfile = screen.getByRole('link', { name: 'My Profile' });
		expect(myProfile).toHaveAttribute('href', '/recruiter/company');

		fireEvent.click(myProfile);
		expect(await screen.findByText('Recruiter Company Page')).toBeInTheDocument();
	});
});
