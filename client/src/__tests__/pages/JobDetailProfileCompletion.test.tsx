import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateDashboard } from '@/pages/candidate/dashboard';
import { CandidateJobDetailPage } from '@/pages/candidate/job-detail';

// #1601 — JT-P1..P3 (PRD prd-job-board-and-profile.md §5.2/§6 FR-P1–P4):
// the job-detail surface must show the candidate's REAL profile completion
// (the canonical value the Profile page and Dashboard show), the ≥80%
// one-click-apply gate must open when earned, a genuinely empty profile
// shows its true low %, and an UNKNOWN completion (stats endpoint failed)
// renders no percentage at all — never a fabricated 0%.

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: {
			id: 7,
			name: 'Journey Candidate',
			email: 'journey@example.com',
			role: 'candidate',
			subscriptionTier: 'pro',
		},
		isAuthenticated: true,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		refreshSubscription: vi.fn(),
		loading: false,
		isRecruiter: false,
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const JOB = {
	id: 42,
	title: 'Data Analyst',
	company: 'Acme',
	description: 'Analyse data.',
	requirements: 'SQL',
	location: 'Remote',
	salary_range: '$80k',
	job_type: 'full-time',
	skills_required: [],
	created_at: '2026-10-01T00:00:00Z',
};

function mockApis(statsBehaviour: { completeness: number } | 'throws') {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/candidate/dashboard/stats')) {
			if (statsBehaviour === 'throws') throw new Error('stats unavailable');
			return {
				success: true,
				stats: {
					profile_completeness: statsBehaviour.completeness,
					missing_sections: [],
				},
			};
		}
		if (url.includes('/candidate/profile')) {
			// The REAL shape of GET /candidate/profile: raw profile row,
			// NO completeness field. This is the shape that produced the bug.
			return { profile: { skills: [] } };
		}
		if (url.includes('/jobs/42')) return { job: JOB };
		if (url.includes('/candidate/applications')) return { applications: [] };
		if (url.includes('/candidate/saved-jobs')) return { saved_jobs: [] };
		if (url.includes('/candidate/auto-fill')) return { auto_fill: null };
		return {};
	});
}

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/candidate/jobs/42']}>
			<Routes>
				<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function openApplyForm() {
	fireEvent.click(await screen.findByRole('button', { name: /apply now/i }));
}

describe('#1601 job-detail profile completion (JT-P1–P3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, json: async () => null })),
		);
	});

	it('JT-P1: completed profile (100%) — no 0% banner, one-click apply opens', async () => {
		mockApis({ completeness: 100 });
		renderPage();
		await openApplyForm();
		expect(await screen.findByRole('button', { name: /one-click apply/i })).toBeInTheDocument();
		expect(screen.queryByText(/% complete/i)).not.toBeInTheDocument();
	});

	it('JT-P2: partial profile (42%) — banner shows the real 42%, gate stays closed', async () => {
		mockApis({ completeness: 42 });
		renderPage();
		expect(await screen.findByText(/your profile is 42% complete/i)).toBeInTheDocument();
		await openApplyForm();
		expect(screen.queryByRole('button', { name: /one-click apply/i })).not.toBeInTheDocument();
	});

	it('JT-P2b boundary: exactly 80% — gate opens, banner hides (>= 80, not > 80)', async () => {
		mockApis({ completeness: 80 });
		renderPage();
		await openApplyForm();
		expect(await screen.findByRole('button', { name: /one-click apply/i })).toBeInTheDocument();
		expect(screen.queryByText(/% complete/i)).not.toBeInTheDocument();
	});

	it('JT-P2c boundary: 79% — banner shows 79%, gate stays closed', async () => {
		mockApis({ completeness: 79 });
		renderPage();
		expect(await screen.findByText(/your profile is 79% complete/i)).toBeInTheDocument();
		await openApplyForm();
		expect(screen.queryByRole('button', { name: /one-click apply/i })).not.toBeInTheDocument();
	});

	it('JT-P3a: genuinely empty profile — true 0% is shown (known zero ≠ unknown)', async () => {
		mockApis({ completeness: 0 });
		renderPage();
		expect(await screen.findByText(/your profile is 0% complete/i)).toBeInTheDocument();
	});

	it('JT-P3b: completion unknown (stats endpoint fails) — NO percentage renders at all', async () => {
		mockApis('throws');
		renderPage();
		// Page itself still renders the job…
		expect(await screen.findByRole('button', { name: /apply now/i })).toBeInTheDocument();
		// …but no fabricated percentage anywhere.
		expect(screen.queryByText(/% complete/i)).not.toBeInTheDocument();
		await openApplyForm();
		expect(screen.queryByRole('button', { name: /one-click apply/i })).not.toBeInTheDocument();
	});
});

// Dashboard stat-card (the other surface fixed in this PR): its description
// previously used `stats?.profile_completeness || 0` — a fabricated 0% while
// stats were loading/unknown.
describe('#1601 dashboard stat-card completion (FR-P3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, json: async () => null })),
		);
	});

	function mockDashboard(statsBehaviour: { completeness: number } | 'throws') {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/candidate/dashboard/stats')) {
				if (statsBehaviour === 'throws') throw new Error('stats unavailable');
				return {
					success: true,
					stats: {
						profile_completeness: statsBehaviour.completeness,
						missing_sections: [],
						applications: 0,
						saved_jobs: 0,
						skills: { total: 0, verified: 0 },
						interviews: { total: 0, avg_score: 0 },
						assessments: { total: 0, passed: 0 },
						omniscore: { total_score: null, score_tier: null },
					},
				};
			}
			if (url.includes('/jobs')) return { jobs: [] };
			if (url.includes('/interviews')) return { interviews: [] };
			return {};
		});
	}

	function renderDashboard() {
		return render(
			<MemoryRouter>
				<CandidateDashboard />
			</MemoryRouter>,
		);
	}

	it('known value — stat card shows the real percentage', async () => {
		mockDashboard({ completeness: 42 });
		renderDashboard();
		expect(await screen.findByText('42% complete')).toBeInTheDocument();
	});

	it('unknown value (stats fails) — stat card shows NO percentage', async () => {
		mockDashboard('throws');
		renderDashboard();
		expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
		expect(screen.queryByText(/% complete/i)).not.toBeInTheDocument();
	});
});
